import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BROLL_DIR, REPO_ROOT, ensureDir } from "@ai-ads/core";
import { categoryFromPath, tagsFromName } from "./broll-match.js";

const run = promisify(execFile);
const BROLL_SOURCE = path.join(os.homedir(), "Downloads", "B-Roll");
const STATE_PATH = path.join(REPO_ROOT, "data", "broll-state.json");
const CATALOG_PATH = path.join(BROLL_DIR, "catalog.json");
const PREVIEWS_DIR = path.join(BROLL_DIR, "previews");

export function listBrollClips(): string[] {
  const clipsDir = path.join(BROLL_DIR, "clips");
  const clips: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === "previews") continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(mp4|mov|webm)$/i.test(name)) clips.push(p);
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

/** Screenshot each B-roll clip for catalog reference (skips existing). */
export async function buildBrollCatalog(limit?: number): Promise<number> {
  ensureDir(PREVIEWS_DIR);
  const clips = listBrollClips();
  const catalog: Array<{
    file: string;
    name: string;
    preview: string;
    category: string;
    tags: string[];
    sourceFolder: string;
  }> = [];
  let done = 0;

  for (const clip of clips) {
    if (limit && done >= limit) break;
    const name = path.basename(clip);
    const preview = path.join(PREVIEWS_DIR, `${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.jpg`);
    const category = categoryFromPath(clip);
    const rel = clip.includes(BROLL_SOURCE) ? path.relative(BROLL_SOURCE, clip) : name;
    const sourceFolder = rel.includes(path.sep) ? rel.split(path.sep)[0]! : "Other";
    const tags = tagsFromName(name);

    if (!fs.existsSync(preview)) {
      try {
        const { stdout } = await run("ffprobe", [
          "-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", clip,
        ]);
        const dur = parseFloat(stdout.trim()) || 5;
        const t = Math.min(dur * 0.35, dur - 0.1);
        await run("ffmpeg", ["-y", "-ss", String(t), "-i", clip, "-frames:v", "1", "-q:v", "3", preview], {
          timeout: 30_000,
        });
        done++;
      } catch {
        /* skip bad clips */
      }
    }
    catalog.push({
      file: clip,
      name,
      preview: fs.existsSync(preview) ? path.relative(REPO_ROOT, preview) : "",
      category,
      tags,
      sourceFolder,
    });
  }

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  return catalog.length;
}

export function loadBrollCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) return [];
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8"));
}
