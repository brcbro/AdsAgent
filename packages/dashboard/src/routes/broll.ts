import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { BROLL_DIR, REPO_ROOT, ensureDir } from "@ai-ads/core";
import {
  CLIPS_DIR, INBOX_DIR, VIDEO_EXT, knownCategories, loadBrollCatalog, pendingInboxEntries, registerHumanClip, reviewThreshold,
  safeClipName, setClipCategory, uniqueDestination, type BrollCatalogEntry,
} from "@ai-ads/pipeline";
import type { BrollIngest } from "../broll-ingest.js";

/** Uploads bigger than this are refused up front; the stream is also cut off at this size. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** URL under /data for a file inside data/, or null when it lives elsewhere. */
function dataUrl(file: string): string | null {
  if (!file) return null;
  const normalized = file.replace(/\\/g, "/");
  const absolute = path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, normalized);
  const relative = path.relative(path.join(REPO_ROOT, "data"), absolute).replace(/\\/g, "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return "/data/" + relative.split("/").map(encodeURIComponent).join("/");
}

const withUrls = (entry: BrollCatalogEntry & { pending?: true }) => ({ ...entry, clipUrl: dataUrl(entry.file), previewUrl: dataUrl(entry.preview) });

function insideLibrary(file: string): boolean {
  const rel = path.relative(BROLL_DIR, path.resolve(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Validate a requested category against the library's known ones; "auto" means the classifier decides. */
function resolveCategory(raw: unknown): { category?: string; error?: string } {
  const value = String(raw ?? "auto").trim();
  if (!value || value.toLowerCase() === "auto") return {};
  const known = knownCategories();
  const match = known.find((c) => c.toLowerCase() === value.toLowerCase());
  return match ? { category: match } : { error: `Unknown category "${value}". Choose one of: ${known.join(", ")}` };
}

function destinationDir(category?: string): string {
  return ensureDir(category ? path.join(CLIPS_DIR, category) : INBOX_DIR);
}

/** Video files under a path: the file itself, or a recursive walk of a folder. */
function collectVideos(root: string, out: string[], depth = 0): void {
  const stat = fs.statSync(root);
  if (stat.isFile()) { if (VIDEO_EXT.test(root)) out.push(root); return; }
  if (!stat.isDirectory() || depth > 6) return;
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) continue;
    try { collectVideos(path.join(root, name), out, depth + 1); } catch { /* unreadable entry */ }
  }
}

/** Catalog, upload, import, classification state and human category corrections for the B-roll library. */
export function registerBrollRoutes(app: express.Express, ingest: BrollIngest): void {
  const fail = (res: express.Response, err: unknown, status = 400) => res.status(status).json({ error: err instanceof Error ? err.message : String(err) });

  app.get("/api/broll/catalog", (_req, res) => {
    res.json([...loadBrollCatalog(), ...pendingInboxEntries()].map(withUrls));
  });

  app.get("/api/broll/ingest", (_req, res) => {
    res.json({ ...ingest.state(), categories: knownCategories(), threshold: reviewThreshold(), inboxDir: INBOX_DIR });
  });
  app.post("/api/broll/ingest/run", (_req, res) => {
    ingest.trigger();
    res.json({ ok: true, ...ingest.state() });
  });

  // One file per request, streamed straight to disk: no multipart parser, no buffering in memory.
  app.put("/api/broll/upload", (req, res) => {
    const name = safeClipName(String(req.query.name ?? ""));
    if (!VIDEO_EXT.test(name)) return res.status(400).json({ error: "Only MP4, MOV or WebM clips can be added" });
    const { category, error } = resolveCategory(req.query.category);
    if (error) return res.status(400).json({ error });
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Clips over 2 GB are too large to upload; use Import from a folder path instead" });
    const dir = destinationDir(category);
    const part = path.join(dir, `${name}.${process.pid}.${Date.now()}.part`);
    const out = fs.createWriteStream(part);
    let received = 0;
    let failed = false;
    const abort = (status: number, message: string) => {
      if (failed) return;
      failed = true;
      req.unpipe(out); out.destroy();
      fs.rm(part, { force: true }, () => {});
      if (!res.headersSent) res.status(status).json({ error: message });
    };
    req.on("data", (chunk: Buffer) => { received += chunk.length; if (received > MAX_UPLOAD_BYTES) abort(413, "Upload exceeded 2 GB"); });
    req.on("aborted", () => abort(400, "Upload interrupted"));
    out.on("error", (err) => abort(500, `Could not write the clip: ${err.message}`));
    out.on("finish", () => {
      if (failed) return;
      if (received === 0) return abort(400, "The uploaded file is empty");
      try {
        const dest = uniqueDestination(dir, name);
        fs.renameSync(part, dest);
        const entry = category ? withUrls(registerHumanClip(dest, category)) : undefined;
        ingest.poke();
        res.json({ ok: true, file: dest, name: path.basename(dest), category: category ?? "auto", entry, bytes: received });
      } catch (err) { abort(500, err instanceof Error ? err.message : String(err)); }
    });
    req.pipe(out);
  });

  // Local paths (files or folders) for big batches on this machine; files are copied, the source stays untouched.
  app.post("/api/broll/import", (req, res) => {
    const raw = req.body?.paths;
    const paths: string[] = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/\r?\n/) : [];
    const list = paths.map((p) => p.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: "Enter at least one file or folder path" });
    if (list.length > 200) return res.status(400).json({ error: "At most 200 paths per import" });
    const { category, error } = resolveCategory(req.body?.category);
    if (error) return res.status(400).json({ error });
    const dir = destinationDir(category);
    const imported: Array<{ source: string; file: string }> = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const item of list) {
      const abs = path.resolve(item);
      if (!fs.existsSync(abs)) { skipped.push({ path: item, reason: "Not found" }); continue; }
      if (insideLibrary(abs)) { skipped.push({ path: item, reason: "Already inside the library folder" }); continue; }
      const videos: string[] = [];
      try { collectVideos(abs, videos); } catch (err) { skipped.push({ path: item, reason: err instanceof Error ? err.message : String(err) }); continue; }
      if (!videos.length) { skipped.push({ path: item, reason: "No MP4, MOV or WebM files" }); continue; }
      for (const source of videos) {
        try {
          const dest = uniqueDestination(dir, safeClipName(path.basename(source)));
          fs.copyFileSync(source, dest);
          if (category) registerHumanClip(dest, category);
          imported.push({ source, file: dest });
        } catch (err) { skipped.push({ path: source, reason: err instanceof Error ? err.message : String(err) }); }
      }
    }
    if (imported.length) ingest.poke();
    res.json({ imported, skipped, category: category ?? "auto" });
  });

  // A person confirms or corrects the category; the clip moves to that folder and counts as confirmed from then on.
  app.post("/api/broll/clips/category", async (req, res) => {
    const file = String(req.body?.file ?? "");
    if (!file || !insideLibrary(file)) return res.status(400).json({ error: "Clip is not inside the B-roll library" });
    const { category, error } = resolveCategory(req.body?.category);
    if (error) return res.status(400).json({ error });
    if (!category) return res.status(400).json({ error: "Choose a category" });
    try { res.json(withUrls(await setClipCategory(file, category))); } catch (err) { fail(res, err); }
  });
}
