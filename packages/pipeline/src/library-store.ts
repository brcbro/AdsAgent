import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, REPO_ROOT } from "@ai-ads/core";

/*
 * The Library lives in the database: every B-roll clip, its preview image, the B-roll catalog
 * and every music track is stored as a blob in data/agent-queue/agent.sqlite (the same database
 * as the agent queue and performance data, so one backup covers all of it).
 *
 * The database is the master copy; the files under data/ are a working copy the renderer reads.
 * sync() stores new or changed files, follows files that moved (the classifier moves clips into
 * their category folder), and writes back any file that is missing on disk — so a fresh server or
 * a wiped data/ folder gets the whole Library back from the database alone.
 *
 * Files are only removed from the database through remove(); deleting a file on disk by hand
 * makes the next sync restore it.
 */

export const LIBRARY_DB_PATH = path.join(REPO_ROOT, "data", "agent-queue", "agent.sqlite");
/** SQLite's default limit for one value is 1,000,000,000 bytes; leave headroom. */
export const MAX_LIBRARY_FILE_BYTES = 950_000_000;

const VIDEO = /\.(mp4|mov|webm)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const AUDIO = /\.(mp3|m4a|wav|aac|ogg)$/i;
const TEMP = /\.(part|tmp|download)$/i;

export type LibraryKind = "broll" | "preview" | "catalog" | "music";

/** Which files under data/ belong to the Library, keyed by their path relative to data/ ("broll/clips/Trading/a.mp4"). */
export function libraryKind(rel: string): LibraryKind | null {
  const p = rel.replace(/\\/g, "/");
  if (TEMP.test(p) || p.split("/").some((part) => part.startsWith("."))) return null;
  if (p === "broll/catalog.json") return "catalog";
  if (p.startsWith("broll/clips/") && VIDEO.test(p)) return "broll";
  if (p.startsWith("broll/previews/") && IMAGE.test(p)) return "preview";
  if (/^music\/[^/]+$/.test(p) && AUDIO.test(p)) return "music";
  return null;
}

export interface LibrarySyncReport {
  at: string;
  durationMs: number;
  /** New files written to the database. */
  stored: number;
  /** Files whose contents changed on disk and were rewritten in the database. */
  updated: number;
  /** Files missing on disk that were written back from the database. */
  restored: number;
  /** Database rows that followed a file to its new path. */
  moved: number;
  unchanged: number;
  /** Files too large for one database value; they stay on disk only. */
  tooLarge: string[];
  /** Files that could not be read or written, with the reason. */
  errors: Array<{ path: string; error: string }>;
}

export interface LibraryImportReport {
  /** Files that were not in this Library yet. */
  added: number;
  /** Files whose contents differed; the imported version replaced them. */
  replaced: number;
  identical: number;
  /** Rows refused: not a Library path, or contents that do not match their checksum. */
  rejected: number;
  /** Clip entries in the merged catalog. */
  catalogEntries: number;
  bytes: number;
}

export interface LibraryStatus {
  files: number;
  bytes: number;
  byKind: Record<LibraryKind, { files: number; bytes: number }>;
}

type Row = { path: string; sha256: string; size: number; mtime_ms: number };
type DiskFile = { abs: string; size: number; mtimeMs: number };

export class LibraryStore {
  readonly db: DatabaseSync;
  private readonly dataDir: string;
  constructor(file = LIBRARY_DB_PATH, dataDir = DATA_DIR, private readonly maxBytes = MAX_LIBRARY_FILE_BYTES) {
    // Normalised, so the "never write outside data/" check works with either slash style.
    this.dataDir = path.resolve(dataDir);
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;
      CREATE TABLE IF NOT EXISTS library_files(path TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL,
        size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, updated_at TEXT NOT NULL, data BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS library_files_sha ON library_files(sha256);`);
  }

  /** Every Library file on disk, keyed by its path relative to data/. */
  scan(): Map<string, DiskFile> {
    const out = new Map<string, DiskFile>();
    const visit = (abs: string, depth: number) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const child = path.join(abs, e.name);
        if (e.isDirectory()) { if (depth < 6) visit(child, depth + 1); continue; }
        if (!e.isFile()) continue;
        const rel = path.relative(this.dataDir, child).replace(/\\/g, "/");
        if (!libraryKind(rel)) continue;
        try { const st = fs.statSync(child); out.set(rel, { abs: child, size: st.size, mtimeMs: Math.round(st.mtimeMs) }); } catch { /* vanished mid-scan */ }
      }
    };
    for (const dir of ["broll/clips", "broll/previews", "music"]) visit(path.join(this.dataDir, dir), 0);
    const catalog = path.join(this.dataDir, "broll", "catalog.json");
    if (fs.existsSync(catalog)) { const st = fs.statSync(catalog); out.set("broll/catalog.json", { abs: catalog, size: st.size, mtimeMs: Math.round(st.mtimeMs) }); }
    return out;
  }

  /** Yields between files that are actually read or written, so the dashboard stays responsive. */
  async sync(): Promise<LibrarySyncReport> {
    const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));
    const t0 = Date.now();
    const report: LibrarySyncReport = { at: new Date().toISOString(), durationMs: 0, stored: 0, updated: 0, restored: 0, moved: 0, unchanged: 0, tooLarge: [], errors: [] };
    const disk = this.scan();
    const rows = this.db.prepare("SELECT path, sha256, size, mtime_ms FROM library_files").all() as unknown as Row[];
    const byPath = new Map(rows.map((r) => [r.path, r]));
    const shaOnDisk = new Set<string>();
    const upsert = this.db.prepare(`INSERT INTO library_files(path, kind, sha256, size, mtime_ms, updated_at, data) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, sha256=excluded.sha256, size=excluded.size, mtime_ms=excluded.mtime_ms,
        updated_at=excluded.updated_at, data=excluded.data`);
    const touch = this.db.prepare("UPDATE library_files SET mtime_ms=?, size=? WHERE path=?");

    // 1. Disk → database: new and changed files. Size + modified time skip the unchanged ones without reading them.
    for (const [rel, f] of disk) {
      const row = byPath.get(rel);
      if (row && row.size === f.size && row.mtime_ms === f.mtimeMs) { report.unchanged++; shaOnDisk.add(row.sha256); continue; }
      if (f.size > this.maxBytes) { report.tooLarge.push(rel); continue; }
      try {
        const data = fs.readFileSync(f.abs);
        const sha = createHash("sha256").update(data).digest("hex");
        shaOnDisk.add(sha);
        if (row && row.sha256 === sha) { touch.run(f.mtimeMs, f.size, rel); report.unchanged++; continue; }
        upsert.run(rel, libraryKind(rel)!, sha, data.length, f.mtimeMs, new Date().toISOString(), data);
        if (row) report.updated++; else report.stored++;
      } catch (err) { report.errors.push({ path: rel, error: (err as Error).message }); }
      await yieldNow();
    }

    // 2. Rows without a file at their path: either the file moved (same contents elsewhere) or it is missing.
    const missing = rows.filter((r) => !disk.has(r.path));
    const remove = this.db.prepare("DELETE FROM library_files WHERE path=?");
    const toRestore: Row[] = [];
    for (const r of missing) {
      if (shaOnDisk.has(r.sha256)) { remove.run(r.path); report.moved++; }
      else toRestore.push(r);
    }
    // The catalog first: the classifier would otherwise see restored clips as new and classify them again.
    toRestore.sort((a, b) => Number(b.path === "broll/catalog.json") - Number(a.path === "broll/catalog.json"));
    for (const r of toRestore) {
      try { this.restore(r.path, r.mtime_ms); report.restored++; }
      catch (err) { report.errors.push({ path: r.path, error: (err as Error).message }); }
      await yieldNow();
    }
    // Keep the main database file complete, so a backup that copies only agent.sqlite has everything.
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* another process holds the database; the next sync retries */ }
    report.durationMs = Date.now() - t0;
    return report;
  }

  /** Writes one stored file back to disk (atomically, keeping its original modified time). */
  restore(rel: string, mtimeMs?: number): string {
    const row = this.db.prepare("SELECT data, mtime_ms FROM library_files WHERE path=?").get(rel) as { data: Uint8Array; mtime_ms: number } | undefined;
    if (!row) throw new Error(`${rel} is not in the Library database`);
    const abs = path.join(this.dataDir, ...rel.split("/"));
    if (!abs.startsWith(this.dataDir + path.sep)) throw new Error(`Refusing to write outside data/: ${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.restore.tmp`;
    fs.writeFileSync(tmp, row.data);
    const when = new Date(mtimeMs ?? row.mtime_ms);
    fs.utimesSync(tmp, when, when);
    fs.renameSync(tmp, abs);
    return abs;
  }

  /** Removes a file from the Library database (and from disk), so the next sync does not restore it. */
  remove(rel: string): boolean {
    const deleted = Number(this.db.prepare("DELETE FROM library_files WHERE path=?").run(rel).changes) > 0;
    const abs = path.join(this.dataDir, ...rel.split("/"));
    if (abs.startsWith(this.dataDir + path.sep)) fs.rmSync(abs, { force: true });
    return deleted;
  }

  /**
   * Writes the Library alone (no agent chats, performance data or tokens) into a new SQLite file,
   * to move it to another machine. Run sync() first so it is current.
   */
  exportTo(file: string): LibraryStatus {
    fs.rmSync(file, { force: true });
    const out = new DatabaseSync(file);
    out.exec(`CREATE TABLE library_files(path TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL,
      size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, updated_at TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE library_export(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    out.prepare("INSERT INTO library_export(key, value) VALUES('format', 'ad-factory-library/1'), ('exported_at', ?)").run(new Date().toISOString());
    const insert = out.prepare("INSERT INTO library_files(path, kind, sha256, size, mtime_ms, updated_at, data) VALUES(?,?,?,?,?,?,?)");
    const paths = (this.db.prepare("SELECT path FROM library_files ORDER BY path").all() as Array<{ path: string }>).map((r) => r.path);
    const read = this.db.prepare("SELECT path, kind, sha256, size, mtime_ms, updated_at, data FROM library_files WHERE path=?");
    out.exec("BEGIN");
    try {
      // One row at a time, so a 600 MB Library never sits in memory at once.
      for (const p of paths) {
        const r = read.get(p) as { path: string; kind: string; sha256: string; size: number; mtime_ms: number; updated_at: string; data: Uint8Array };
        insert.run(r.path, r.kind, r.sha256, r.size, r.mtime_ms, r.updated_at, r.data);
      }
      out.exec("COMMIT");
    } catch (err) { out.exec("ROLLBACK"); out.close(); fs.rmSync(file, { force: true }); throw err; }
    out.close();
    return this.status();
  }

  /**
   * Adds a Library exported from another machine: new and changed files are stored and written to disk
   * (the imported version wins), identical ones are skipped, nothing is deleted. Catalog entries are merged,
   * so clips that only exist here keep theirs. Only Library paths are accepted from the file.
   */
  async importFrom(file: string): Promise<LibraryImportReport> {
    const src = new DatabaseSync(file, { readOnly: true });
    const report: LibraryImportReport = { added: 0, replaced: 0, identical: 0, rejected: 0, catalogEntries: 0, bytes: 0 };
    try {
      const hasTable = src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='library_files'").get();
      if (!hasTable) throw new Error("This file is not a Library export (no library_files table)");
      const rows = src.prepare("SELECT path, sha256, size, mtime_ms FROM library_files").all() as unknown as Row[];
      const current = new Map((this.db.prepare("SELECT path, sha256 FROM library_files").all() as Array<{ path: string; sha256: string }>).map((r) => [r.path, r.sha256]));
      const read = src.prepare("SELECT data FROM library_files WHERE path=?");
      const upsert = this.db.prepare(`INSERT INTO library_files(path, kind, sha256, size, mtime_ms, updated_at, data) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, sha256=excluded.sha256, size=excluded.size, mtime_ms=excluded.mtime_ms,
          updated_at=excluded.updated_at, data=excluded.data`);

      // The catalog first, merged rather than replaced: the classifier would otherwise see imported clips
      // as new and classify them again, and clips that only exist here would lose their entries.
      const catalogRow = rows.find((r) => r.path === "broll/catalog.json");
      if (catalogRow) {
        try {
          const { data } = read.get(catalogRow.path) as { data: Uint8Array };
          const imported = JSON.parse(Buffer.from(data).toString("utf8")) as Array<Record<string, unknown>>;
          if (!Array.isArray(imported)) throw new Error("not a list");
          const before = this.readCatalogFile();
          const { count, changed } = this.mergeCatalog(before, imported);
          report.catalogEntries = count;
          if (!changed) report.identical++; else if (fs.existsSync(this.absolute(catalogRow.path))) report.replaced++; else report.added++;
        } catch { report.rejected++; }
      }

      for (const r of rows) {
        if (r === catalogRow) continue;
        const kind = libraryKind(r.path);
        if (!kind || r.path.includes("..")) { report.rejected++; continue; }
        const had = current.get(r.path);
        if (had === r.sha256 && fs.existsSync(this.absolute(r.path))) { report.identical++; continue; }
        const { data } = read.get(r.path) as { data: Uint8Array };
        const sha = createHash("sha256").update(data).digest("hex");
        if (sha !== r.sha256) { report.rejected++; continue; } // damaged in transit
        upsert.run(r.path, kind, sha, data.length, r.mtime_ms, new Date().toISOString(), data);
        this.restore(r.path, r.mtime_ms);
        report.bytes += data.length;
        if (had === undefined) report.added++; else report.replaced++;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      src.close();
    }
    await this.sync();
    return report;
  }

  private absolute(rel: string): string {
    return path.join(this.dataDir, ...rel.split("/"));
  }

  private readCatalogFile(): Array<Record<string, unknown>> {
    try { return JSON.parse(fs.readFileSync(this.absolute("broll/catalog.json"), "utf8")); } catch { return []; }
  }

  /** Imported catalog entries win; entries for clips that exist only here are kept. Keyed by the clip's place under clips/. */
  private mergeCatalog(previous: Array<Record<string, unknown>>, imported: Array<Record<string, unknown>>): { count: number; changed: boolean } {
    const key = (e: Record<string, unknown>) => {
      const m = /(?:^|[\\/])clips[\\/](.+)$/i.exec(String(e.file ?? ""));
      return (m ? m[1] : String(e.name ?? e.file ?? "")).replace(/\\/g, "/").toLowerCase();
    };
    const merged = new Map<string, Record<string, unknown>>();
    for (const e of previous) merged.set(key(e), e);
    for (const e of imported) merged.set(key(e), e);
    const list = [...merged.values()];
    const text = JSON.stringify(list, null, 2);
    const target = this.absolute("broll/catalog.json");
    let existing = "";
    try { existing = fs.readFileSync(target, "utf8"); } catch { existing = ""; }
    if (existing === text) return { count: list.length, changed: false };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, target);
    return { count: list.length, changed: true };
  }

  status(): LibraryStatus {
    const byKind = { broll: { files: 0, bytes: 0 }, preview: { files: 0, bytes: 0 }, catalog: { files: 0, bytes: 0 }, music: { files: 0, bytes: 0 } };
    for (const r of this.db.prepare("SELECT kind, COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM library_files GROUP BY kind").all()) {
      const kind = String(r.kind) as LibraryKind;
      if (kind in byKind) byKind[kind] = { files: Number(r.files), bytes: Number(r.bytes) };
    }
    const all = Object.values(byKind);
    return { files: all.reduce((n, k) => n + k.files, 0), bytes: all.reduce((n, k) => n + k.bytes, 0), byKind };
  }

  close() { this.db.close(); }
}
