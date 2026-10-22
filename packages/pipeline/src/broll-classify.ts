import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { BROLL_DIR, REPO_ROOT, ensureDir } from "@ai-ads/core";
import { BROLL_CATEGORIES, tagsFromName, type BrollCatalogEntry } from "./broll-match.js";
import {
  CLIPS_DIR, INBOX_DIR, VIDEO_EXT, catalogEntryFor, ensurePreview, listBrollClips, listInboxClips, loadBrollCatalog,
  previewPathFor, uniqueDestination, upsertCatalog,
} from "./broll.js";
import { chatJson, type ChatImage } from "./llm.js";
import { resolveFfmpegBin } from "./ffmpeg-render.js";

/*
 * Always-on B-roll classifier. Every clip that enters the library through the inbox (dashboard
 * upload, import, or a file dropped into data/broll/inbox/) gets three sampled frames sent to the
 * configured vision-capable model, which returns a category, tags and a confidence. The clip is
 * then moved under data/broll/clips/<Category>/ and written into catalog.json; low confidence
 * marks it needsReview for a person to confirm in the Library. Confirmed entries are never
 * re-classified, so running the job again is a no-op for them.
 */

const run = promisify(execFile);
export const INGEST_STATE_PATH = path.join(BROLL_DIR, "ingest-state.json");
export const INGEST_LOCK_PATH = path.join(REPO_ROOT, "data", "agent-queue", "broll-ingest.lock");
export const MANUAL_RENDER_LOCK_PATH = path.join(REPO_ROOT, "data", "agent-queue", "manual-render.lock");
/** A lock older than this is from a crashed process and may be taken over (same rule as the worker). */
export const LOCK_STALE_MS = 40_000;
/** A file in the inbox is picked up only once it stopped changing for this long (a copy in progress). */
export const STABLE_MS = 3_000;
export const DEFAULT_REVIEW_THRESHOLD = 0.7;
export const CLASSIFY_CATEGORIES = BROLL_CATEGORIES;

export function reviewThreshold(): number {
  const n = Number(process.env.BROLL_REVIEW_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_REVIEW_THRESHOLD;
}

export interface IngestError { file: string; message: string; at: string }
export interface IngestState {
  running: boolean;
  startedAt?: string;
  /** Clips found by the last scan, and how many are handled so far. */
  total: number;
  done: number;
  current?: string;
  errors: IngestError[];
  lastRunAt?: string;
  lastResult?: string;
}
export const EMPTY_STATE: IngestState = { running: false, total: 0, done: 0, errors: [] };

export function readIngestState(): IngestState {
  try { return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(INGEST_STATE_PATH, "utf8")) }; } catch { return { ...EMPTY_STATE }; }
}
export function writeIngestState(state: IngestState): void {
  ensureDir(path.dirname(INGEST_STATE_PATH));
  fs.writeFileSync(INGEST_STATE_PATH, JSON.stringify(state, null, 2));
}

/** The dashboard writes this file while its manual renderer runs; the worker and this job pause meanwhile. */
export function isManualRenderActive(lockPath = MANUAL_RENDER_LOCK_PATH, now = Date.now()): boolean {
  try { return now - fs.statSync(lockPath).mtimeMs < LOCK_STALE_MS; } catch { return false; }
}

/** Single-instance lock shared by the dashboard scheduler and the `pnpm broll-classify` CLI. */
export function acquireIngestLock(owner: string, lockPath = INGEST_LOCK_PATH, now = Date.now()): boolean {
  ensureDir(path.dirname(lockPath));
  try {
    const stat = fs.statSync(lockPath);
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { owner?: string };
    if (held.owner !== owner && now - stat.mtimeMs < LOCK_STALE_MS) return false;
  } catch { /* no lock or unreadable: take it */ }
  fs.writeFileSync(lockPath, JSON.stringify({ owner, pid: process.pid, at: new Date(now).toISOString() }));
  return true;
}
export function heartbeatIngestLock(owner: string, lockPath = INGEST_LOCK_PATH): void {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { owner?: string };
    if (held.owner === owner) { const t = new Date(); fs.utimesSync(lockPath, t, t); }
  } catch { /* lost */ }
}
export function releaseIngestLock(owner: string, lockPath = INGEST_LOCK_PATH): void {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { owner?: string };
    if (held.owner === owner) fs.unlinkSync(lockPath);
  } catch { /* already gone */ }
}

/** True once the file has content and has not been written to for STABLE_MS. */
export function isStableFile(file: string, now = Date.now(), stableMs = STABLE_MS): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0 && now - stat.mtimeMs >= stableMs;
  } catch { return false; }
}

/** Known categories: the agent's four, plus any folder under clips/ and any category already in the catalog. */
export function knownCategories(catalog: BrollCatalogEntry[] = loadBrollCatalog()): string[] {
  const names = new Set<string>(BROLL_CATEGORIES);
  if (fs.existsSync(CLIPS_DIR)) {
    for (const name of fs.readdirSync(CLIPS_DIR)) {
      if (!name.startsWith(".") && name !== "previews" && fs.statSync(path.join(CLIPS_DIR, name)).isDirectory()) names.add(name);
    }
  }
  for (const entry of catalog) if (entry.category && entry.category !== "Other" && entry.category !== "Unsorted") names.add(entry.category);
  return [...names];
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Map a model's answer onto a known category (case and punctuation insensitive); null when it is none of them. */
export function normalizeCategory(raw: string, known: readonly string[]): string | null {
  const key = fold(raw);
  if (!key) return null;
  return known.find((c) => fold(c) === key) ?? known.find((c) => key.includes(fold(c)) || fold(c).includes(key)) ?? null;
}

/** Final category and review flag from the model's answer: unknown categories become "Other" and always need review. */
export function decideCategory(raw: string, confidence: number, known: readonly string[], threshold = reviewThreshold()):
  { category: string; confidence: number; needsReview: boolean } {
  const category = normalizeCategory(raw, known);
  const c = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0));
  if (!category) return { category: "Other", confidence: c, needsReview: true };
  return { category, confidence: c, needsReview: c < threshold };
}

export const ClassificationSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).max(12),
  description: z.string().max(240),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const CATEGORY_HINTS: Record<string, string> = {
  Trading: "trading charts, candlesticks, stock or crypto tickers, trading screens and monitors, markets, money, phones showing portfolios",
  Lifestyle: "travel, luxury, cars, beaches, pools, cities, freedom, leisure, aspirational living",
  "Deep Work": "a person working at a laptop or desk, typing, focused study, notes, home office, concentration",
  Community: "people talking or explaining to camera, gestures, groups, meetings, phones with social apps, interaction",
};

export function classificationPrompt(categories: readonly string[]): { system: string; user: string } {
  const list = categories.map((c) => `- ${c}: ${CATEGORY_HINTS[c] ?? "footage that belongs to this library folder"}`).join("\n");
  return {
    system: [
      "You sort stock B-roll clips for short German finance ads into library categories.",
      "You see a few frames sampled from one clip. Decide which ONE category fits best:",
      list,
      "Rules: category must be exactly one of the names above. confidence is your probability (0 to 1) that the category is right;",
      "use below 0.7 when the frames are ambiguous or fit two categories equally. tags are 3 to 10 short lowercase English words",
      "describing visible subjects, setting and mood. description is one short sentence of what the clip shows.",
    ].join("\n"),
    user: "Classify this clip from the sampled frames. Reply with the JSON object only; do not repeat the schema.",
  };
}

/** Probe duration and extract `count` JPEG frames spread over the clip, scaled to 512 px wide. */
export async function sampleFrames(file: string, count = 3): Promise<ChatImage[]> {
  const ffmpeg = resolveFfmpegBin();
  const ffprobe = ffmpeg.endsWith("ffmpeg") ? ffmpeg.slice(0, -"ffmpeg".length) + "ffprobe" : "ffprobe";
  let duration = 5;
  try {
    const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], { timeout: 30_000 });
    duration = parseFloat(stdout.trim()) || 5;
  } catch { /* keep the default */ }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-frames-"));
  try {
    const images: ChatImage[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.max(0, Math.min(duration * ((i + 1) / (count + 1)), duration - 0.1));
      const out = path.join(dir, `frame-${i}.jpg`);
      await run(ffmpeg, ["-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", out], { timeout: 30_000 });
      if (fs.existsSync(out)) images.push({ mediaType: "image/jpeg", base64: fs.readFileSync(out).toString("base64") });
    }
    if (!images.length) throw new Error("ffmpeg produced no frames");
    return images;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface ClassifyDeps {
  frames?: (file: string) => Promise<ChatImage[]>;
  chat?: typeof chatJson;
}

/** Vision classification of one clip; `deps` lets tests skip ffmpeg and the network. */
export async function classifyClip(file: string, categories: readonly string[] = CLASSIFY_CATEGORIES, deps: ClassifyDeps = {}): Promise<Classification> {
  const images = await (deps.frames ?? sampleFrames)(file);
  const prompt = classificationPrompt(categories);
  return (deps.chat ?? chatJson)({
    schema: ClassificationSchema, schemaName: "broll_classification", system: prompt.system, user: prompt.user, images,
    model: process.env.BROLL_CLASSIFY_MODEL || undefined,
  });
}

/** Move a clip under clips/<Category>/ (de-duplicating the name) and carry its preview along; returns the new path. */
export function moveClipToCategory(file: string, category: string): string {
  const dir = ensureDir(path.join(CLIPS_DIR, category));
  if (path.dirname(file) === dir) return file;
  const dest = uniqueDestination(dir, path.basename(file));
  try { fs.renameSync(file, dest); } catch { fs.copyFileSync(file, dest); fs.unlinkSync(file); }
  const oldPreview = previewPathFor(file);
  const newPreview = previewPathFor(dest);
  if (oldPreview !== newPreview && fs.existsSync(oldPreview) && !fs.existsSync(newPreview)) fs.renameSync(oldPreview, newPreview);
  return dest;
}

/** Union of name-derived tags and the model's tags, lowercase, de-duplicated. */
export function mergeTags(name: string, extra: string[] = []): string[] {
  const out = new Set<string>();
  for (const t of [...tagsFromName(name), ...extra]) { const clean = t.trim().toLowerCase(); if (clean.length > 1) out.add(clean); }
  return [...out].slice(0, 24);
}

/** Record a clip that a person already placed (upload with a chosen category); the preview follows on the next ingest run. */
export function registerHumanClip(file: string, category: string): BrollCatalogEntry {
  const entry: BrollCatalogEntry = {
    ...catalogEntryFor(file, fs.existsSync(previewPathFor(file)) ? path.relative(REPO_ROOT, previewPathFor(file)) : ""),
    category, source: "human", confidence: 1, needsReview: false, classifiedAt: new Date().toISOString(), addedAt: new Date().toISOString(),
  };
  upsertCatalog([entry]);
  return entry;
}

/** A person confirms or corrects a category: move the file if needed and mark the entry confirmed. */
export async function setClipCategory(file: string, category: string): Promise<BrollCatalogEntry> {
  const current = loadBrollCatalog().find((e) => e.file === file);
  if (!current && !fs.existsSync(file)) throw new Error("Clip not found in the catalog");
  const dest = moveClipToCategory(file, category);
  const preview = await ensurePreview(dest);
  const entry: BrollCatalogEntry = {
    ...catalogEntryFor(dest, preview, current), category, source: "human", confidence: 1, needsReview: false,
    classifiedAt: new Date().toISOString(),
  };
  upsertCatalog([entry], dest === file ? [] : [file]);
  return entry;
}

export interface PendingWork {
  /** Inbox files ready to classify (stable). */
  inbox: string[];
  /** Clips under clips/<Category>/ that the catalog does not know yet: folder placement counts as the decision. */
  unlisted: string[];
  /** Catalog entries placed as "Other" by the old name heuristics, never confirmed: classify them too. */
  other: BrollCatalogEntry[];
  /** Entries without a preview yet (e.g. human-categorised uploads). */
  missingPreview: BrollCatalogEntry[];
}

/** `skip` leaves out files on a retry cooldown (the dashboard backs off after an error). */
export function findPendingWork(now = Date.now(), skip: (file: string) => boolean = () => false): PendingWork {
  const catalog = loadBrollCatalog();
  const known = new Set(catalog.map((e) => e.file));
  const inbox = listInboxClips().filter((f) => isStableFile(f, now) && !skip(f));
  const unlisted = listBrollClips().filter((f) => !known.has(f) && f.startsWith(CLIPS_DIR) && isStableFile(f, now) && !skip(f));
  const other = catalog.filter((e) => (e.category === "Other" || e.category === "Unsorted") && e.source !== "human" && fs.existsSync(e.file) && !skip(e.file));
  const missingPreview = catalog.filter((e) => !e.preview && fs.existsSync(e.file) && !skip(e.file));
  return { inbox, unlisted, other, missingPreview };
}

export interface IngestOptions {
  /** While true the job waits between clips (manual render lock, running agent job). */
  shouldPause?: () => boolean;
  onProgress?: (state: IngestState) => void;
  log?: (line: string) => void;
  /** Lock owner id; defaults to a per-process id. */
  owner?: string;
  deps?: ClassifyDeps;
  /** Cooperative stop: checked between clips. */
  shouldStop?: () => boolean;
  /** Files to leave out of this run (retry cooldown after an error). */
  skip?: (file: string) => boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One ingest run: previews for unlisted clips, classification for inbox and "Other" clips. Returns the final state. */
export async function runBrollIngest(opts: IngestOptions = {}): Promise<IngestState> {
  const owner = opts.owner ?? `ingest_${process.pid}`;
  const log = opts.log ?? (() => {});
  if (!acquireIngestLock(owner)) {
    const state = readIngestState();
    log("Another classification run holds the lock; skipping");
    return state;
  }
  const heartbeat = setInterval(() => heartbeatIngestLock(owner), 2000);
  const shouldPause = opts.shouldPause ?? (() => isManualRenderActive());
  const state: IngestState = { ...EMPTY_STATE, running: true, startedAt: new Date().toISOString() };
  const publish = () => { writeIngestState(state); opts.onProgress?.(state); };
  const fail = (file: string, err: unknown) => {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    state.errors.push({ file, message, at: new Date().toISOString() });
    log(`✗ ${path.basename(file)}: ${message}`);
  };
  const waitWhilePaused = async () => {
    let waited = false;
    while (shouldPause() && !opts.shouldStop?.()) { if (!waited) { state.current = "Paused while a render is running"; publish(); waited = true; } await sleep(2000); }
  };
  let classified = 0;
  try {
    const work = findPendingWork(Date.now(), opts.skip);
    const categories = knownCategories();
    state.total = work.inbox.length + work.unlisted.length + work.other.length + work.missingPreview.length;
    publish();
    log(`Ingest: ${work.inbox.length} in inbox, ${work.unlisted.length} unlisted, ${work.other.length} unsorted, ${work.missingPreview.length} without preview`);

    for (const entry of work.missingPreview) {
      if (opts.shouldStop?.()) break;
      await waitWhilePaused();
      state.current = entry.name; publish();
      try { upsertCatalog([{ ...entry, preview: await ensurePreview(entry.file) }]); } catch (err) { fail(entry.file, err); }
      state.done++;
    }
    for (const file of work.unlisted) {
      if (opts.shouldStop?.()) break;
      await waitWhilePaused();
      state.current = path.basename(file); publish();
      try {
        const preview = await ensurePreview(file);
        upsertCatalog([{ ...catalogEntryFor(file, preview), source: "folder", addedAt: new Date().toISOString() }]);
      } catch (err) { fail(file, err); }
      state.done++;
    }
    const toClassify: Array<{ file: string; previous?: BrollCatalogEntry }> = [
      ...work.inbox.map((file) => ({ file })),
      ...work.other.map((entry) => ({ file: entry.file, previous: entry })),
    ];
    for (const { file, previous } of toClassify) {
      if (opts.shouldStop?.()) break;
      await waitWhilePaused();
      state.current = path.basename(file); publish();
      try {
        const result = await classifyClip(file, categories, opts.deps);
        const decision = decideCategory(result.category, result.confidence, categories);
        const dest = moveClipToCategory(file, decision.category);
        const preview = await ensurePreview(dest);
        const entry: BrollCatalogEntry = {
          ...catalogEntryFor(dest, preview),
          category: decision.category, tags: mergeTags(path.basename(dest), result.tags), source: "classifier",
          confidence: Math.round(decision.confidence * 100) / 100, needsReview: decision.needsReview,
          classifiedAt: new Date().toISOString(), description: result.description.trim() || undefined,
          addedAt: previous?.addedAt ?? new Date().toISOString(),
        };
        upsertCatalog([entry], dest === file ? [] : [file]);
        classified++;
        log(`✓ ${path.basename(dest)} → ${decision.category} (${Math.round(decision.confidence * 100)}%${decision.needsReview ? ", needs review" : ""})`);
      } catch (err) { fail(file, err); }
      state.done++;
    }
    state.lastResult = `${classified} classified, ${state.done - classified} catalogued, ${state.errors.length} failed`;
  } catch (err) {
    state.lastResult = `Run failed: ${err instanceof Error ? err.message : String(err)}`;
    log(state.lastResult);
  } finally {
    clearInterval(heartbeat);
    releaseIngestLock(owner);
    state.running = false; state.current = undefined; state.lastRunAt = new Date().toISOString();
    publish();
  }
  return state;
}

/** Whether a scan would find anything to do (cheap; used by the dashboard poller). */
export function hasPendingWork(now = Date.now(), skip?: (file: string) => boolean): boolean {
  const work = findPendingWork(now, skip);
  return work.inbox.length + work.unlisted.length + work.other.length + work.missingPreview.length > 0;
}

/** Inbox clips for the Library view: not in the catalog, shown as "Unsorted" while they wait. */
export function pendingInboxEntries(): Array<BrollCatalogEntry & { pending: true }> {
  return listInboxClips().map((file) => ({
    file, name: path.basename(file), preview: "", category: "Unsorted", tags: tagsFromName(path.basename(file)), pending: true as const,
  }));
}

export { INBOX_DIR, CLIPS_DIR, VIDEO_EXT };
