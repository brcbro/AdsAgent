import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BROLL_DIR, REPO_ROOT, ensureDir } from "@ai-ads/core";
import { categoryFromPath, tagsFromName, type BrollCatalogEntry } from "./broll-match.js";

const run = promisify(execFile);
const BROLL_SOURCE = path.join(os.homedir(), "Downloads", "B-Roll");
const STATE_PATH = path.join(REPO_ROOT, "data", "broll-state.json");
export const CATALOG_PATH = path.join(BROLL_DIR, "catalog.json");
export const PREVIEWS_DIR = path.join(BROLL_DIR, "previews");
export const CLIPS_DIR = path.join(BROLL_DIR, "clips");
/** Watch folder: clips dropped or uploaded here are classified and then moved under clips/<Category>/. */
export const INBOX_DIR = path.join(BROLL_DIR, "inbox");
export const VIDEO_EXT = /\.(mp4|mov|webm)$/i;

export function listBrollClips(): string[] {
  const clipsDir = path.join(BROLL_DIR, "clips");
  const clips: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === "previews") continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (VIDEO_EXT.test(name)) clips.push(p);
    }
  };
  walk(clipsDir);
  if (clips.length === 0) walkSourceTree(BROLL_SOURCE, clips);
  return [...new Set(clips)].sort();
}

function walkSourceTree(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkSourceTree(p, out);
    else if (/\.(mp4|mov|webm)$/i.test(name)) out.push(p);
  }
}

/** Per-project rotated clip order — no repeats within one video, different offset per adId. */
export function pickBrollSequence(adId: string, count: number, excluded: string[] = []): string[] {
  const skip = new Set(excluded);
  const all = listBrollClips().filter((clip) => !skip.has(clip));
  if (all.length === 0) return [];

  const hash = createHash("md5").update(adId).digest();
  let offset = hash.readUInt32BE(0) % all.length;

  const state = loadState();
  if (state.lastGlobalOffset !== undefined) {
    offset = (state.lastGlobalOffset + hash.readUInt16BE(4) + 17) % all.length;
  }
  state.lastGlobalOffset = offset;
  saveState(state);

  const picked: string[] = [];
  const used = new Set<string>();
  let i = 0;
  while (picked.length < count && i < all.length * 2) {
    const clip = all[(offset + i) % all.length];
    i++;
    if (used.has(clip)) continue;
    used.add(clip);
    picked.push(clip);
  }
  return picked;
}

function loadState(): { lastGlobalOffset?: number } {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveState(state: { lastGlobalOffset?: number }) {
  ensureDir(path.dirname(STATE_PATH));
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Symlink all source B-roll into data/broll/clips — preserves category folder in filename. */
export function syncBrollClips(): number {
  const dest = ensureDir(path.join(BROLL_DIR, "clips"));
  for (const f of fs.readdirSync(dest)) {
    const p = path.join(dest, f);
    if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
  }
  let n = 0;
  const sourceClips: string[] = [];
  walkSourceTree(BROLL_SOURCE, sourceClips);
  for (const clip of sourceClips) {
    const rel = path.relative(BROLL_SOURCE, clip);
    const folder = rel.includes(path.sep) ? rel.split(path.sep)[0]! : "Other";
    const folderTag = folder
      .replace(/&/g, "and")
      .replace(/\s+Content$/i, "")
      .replace(/\s+/g, "_")
      .slice(0, 24);
    const base = path.basename(clip).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 50);
    const safe = `${folderTag}_${String(++n).padStart(3, "0")}_${base}`;
    const ext = path.extname(clip) || ".mp4";
    fs.symlinkSync(clip, path.join(dest, safe + ext));
  }
  return n;
}

/** Preview jpg path for a clip (one frame at 35 % of the duration). */
export function previewPathFor(clip: string): string {
  return path.join(PREVIEWS_DIR, `${path.basename(clip).replace(/[^a-zA-Z0-9._-]/g, "_")}.jpg`);
}

/** Extract the preview frame unless it already exists; returns the repo-relative path or "" when ffmpeg failed. */
export async function ensurePreview(clip: string): Promise<string> {
  ensureDir(PREVIEWS_DIR);
  const preview = previewPathFor(clip);
  if (!fs.existsSync(preview)) {
    try {
      const { stdout } = await run("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", clip,
      ]);
      const dur = parseFloat(stdout.trim()) || 5;
      const t = Math.max(0, Math.min(dur * 0.35, dur - 0.1));
      await run("ffmpeg", ["-y", "-ss", String(t), "-i", clip, "-frames:v", "1", "-q:v", "3", preview], {
        timeout: 30_000,
      });
    } catch {
      /* bad clip: no preview */
    }
  }
  return fs.existsSync(preview) ? path.relative(REPO_ROOT, preview) : "";
}

/** Catalog entry for a clip from its path alone (folder category, name tags); `previous` keeps classifier/human fields. */
export function catalogEntryFor(clip: string, preview: string, previous?: BrollCatalogEntry): BrollCatalogEntry {
  const name = path.basename(clip);
  const rel = clip.includes(BROLL_SOURCE) ? path.relative(BROLL_SOURCE, clip) : name;
  const sourceFolder = rel.includes(path.sep) ? rel.split(path.sep)[0]! : "Other";
  const folderCategory = categoryFromPath(clip);
  const entry: BrollCatalogEntry = { file: clip, name, preview, category: folderCategory, tags: tagsFromName(name), sourceFolder };
  if (!previous) return entry;
  // A human or classifier decision outranks the folder heuristics only while the clip still sits in that folder.
  const keep = previous.source && previous.source !== "folder" && previous.category === folderCategory;
  return {
    ...entry,
    ...(previous.tags?.length ? { tags: previous.tags } : {}),
    ...(keep ? { source: previous.source, confidence: previous.confidence, needsReview: previous.needsReview,
      classifiedAt: previous.classifiedAt } : {}),
    ...(previous.description ? { description: previous.description } : {}),
    ...(previous.addedAt ? { addedAt: previous.addedAt } : {}),
  };
}

/** Screenshot each B-roll clip for catalog reference (skips existing previews, keeps classifier fields). */
export async function buildBrollCatalog(limit?: number): Promise<number> {
  ensureDir(PREVIEWS_DIR);
  const clips = listBrollClips();
  const previous = new Map(loadBrollCatalog().map((e) => [e.file, e]));
  const catalog: BrollCatalogEntry[] = [];
  let done = 0;
  for (const clip of clips) {
    if (limit && done >= limit) break;
    const had = fs.existsSync(previewPathFor(clip));
    const preview = await ensurePreview(clip);
    if (!had && preview) done++;
    catalog.push(catalogEntryFor(clip, preview, previous.get(clip)));
  }
  writeBrollCatalog(catalog);
  return catalog.length;
}

export function writeBrollCatalog(catalog: BrollCatalogEntry[]): void {
  ensureDir(path.dirname(CATALOG_PATH));
  const tmp = `${CATALOG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmp, CATALOG_PATH);
}

/** Replace or add entries by file path and drop `removeFiles`; other entries are untouched. */
export function upsertCatalog(entries: BrollCatalogEntry[], removeFiles: string[] = []): BrollCatalogEntry[] {
  const drop = new Set(removeFiles);
  const byFile = new Map(loadBrollCatalog().filter((e) => !drop.has(e.file)).map((e) => [e.file, e]));
  for (const entry of entries) byFile.set(entry.file, entry);
  const catalog = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  writeBrollCatalog(catalog);
  return catalog;
}

/** `name.mp4` → `name-2.mp4`, `name-3.mp4`… until no file of that name exists in `dir`. */
export function uniqueDestination(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem}-${i}${ext}`);
  return candidate;
}

/** Only ASCII letters, digits, dot, dash and underscore survive; keeps the extension. */
export function safeClipName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return base || `clip-${Date.now()}`;
}

/** Video files in the inbox, oldest first; `.part` uploads in progress are not videos. */
export function listInboxClips(): string[] {
  if (!fs.existsSync(INBOX_DIR)) return [];
  return fs.readdirSync(INBOX_DIR)
    .filter((n) => VIDEO_EXT.test(n))
    .map((n) => path.join(INBOX_DIR, n))
    .filter((p) => fs.statSync(p).isFile())
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

export function loadBrollCatalog(): BrollCatalogEntry[] {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")); } catch { return []; }
}
