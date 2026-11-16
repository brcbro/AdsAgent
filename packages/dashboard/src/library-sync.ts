import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type express from "express";
import { LibraryStore, type LibraryImportReport, type LibraryStatus, type LibrarySyncReport } from "@ai-ads/pipeline";

/*
 * Keeps the Library (B-roll clips, previews, catalog, music) stored in the database.
 * On start it restores anything missing on disk and stores anything new; then it re-syncs every
 * 10 minutes and shortly after uploads, imports, category changes and classifier runs.
 * Sync, export and import take turns (one lock); a sync requested meanwhile runs once afterwards.
 *
 * Moving the Library to another dashboard (e.g. the hosted one): Download Library here gives one
 * SQLite file with the Library only; Import Library there uploads it in chunks small enough for
 * the proxy in front of the site, then merges it into that dashboard's database and disk.
 */

const START_DELAY_MS = 3_000;
const INTERVAL_MS = 10 * 60_000;
const POKE_DELAY_MS = 15_000;
/** Each upload request stays well under the 100 MB request limit of the proxy in front of the hosted site. */
export const IMPORT_CHUNK_BYTES = 32 * 1_048_576;
const MAX_IMPORT_BYTES = 20 * 1_073_741_824;
const IMPORT_DIR = path.join(os.tmpdir(), "ad-factory-library-import");
const STALE_UPLOAD_MS = 24 * 60 * 60_000;

export function installLibrarySync() {
  const store = new LibraryStore();
  let busy: Promise<unknown> = Promise.resolve();
  let running = false;
  let activity: "sync" | "export" | "import" | null = null;
  let again = false;
  let closing = false;
  let last: LibrarySyncReport | null = null;
  let lastError: string | null = null;
  let lastImport: (LibraryImportReport & { at: string }) | null = null;
  let pokeTimer: NodeJS.Timeout | undefined;

  /** Runs `fn` after whatever is in progress; nothing else touches the Library meanwhile. */
  function exclusive<T>(what: "sync" | "export" | "import", fn: () => Promise<T>): Promise<T> {
    const next = busy.then(async () => {
      running = true; activity = what;
      try { return await fn(); } finally { running = false; activity = null; }
    });
    busy = next.catch(() => undefined);
    return next;
  }

  let queued = false;
  async function run(): Promise<LibrarySyncReport | null> {
    if (closing) return null;
    if (queued) { again = true; return null; }
    queued = true;
    try {
      return await exclusive("sync", async () => {
        queued = false;
        try {
          last = await store.sync();
          lastError = null;
          const changed = last.stored + last.updated + last.restored + last.moved;
          if (changed || last.errors.length || last.tooLarge.length) {
            console.log(`[library] stored ${last.stored}, updated ${last.updated}, restored ${last.restored}, moved ${last.moved}` +
              `${last.errors.length ? `, ${last.errors.length} failed` : ""}${last.tooLarge.length ? `, ${last.tooLarge.length} too large` : ""}`);
          }
          return last;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`[library] sync failed: ${lastError}`);
          return null;
        }
      });
    } finally {
      queued = false;
      if (again && !closing) { again = false; void run(); }
    }
  }

  // Uploads left behind by an interrupted import are cleared after a day.
  try {
    for (const f of fs.existsSync(IMPORT_DIR) ? fs.readdirSync(IMPORT_DIR) : []) {
      const p = path.join(IMPORT_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > STALE_UPLOAD_MS) fs.rmSync(p, { force: true });
    }
  } catch { /* best effort */ }

  const startTimer = setTimeout(() => void run(), START_DELAY_MS);
  const interval = setInterval(() => void run(), INTERVAL_MS);
  startTimer.unref(); interval.unref();

  return {
    run,
    /** Something changed in the Library: sync soon, once, even if several changes arrive together. */
    poke: () => {
      if (closing) return;
      clearTimeout(pokeTimer);
      pokeTimer = setTimeout(() => void run(), POKE_DELAY_MS);
      pokeTimer.unref();
    },
    /** A current copy of the Library alone, in a new SQLite file. */
    exportTo: (file: string) => exclusive("export", async () => { last = await store.sync(); return store.exportTo(file); }),
    importFrom: (file: string) => exclusive("import", async () => {
      const report = await store.importFrom(file);
      lastImport = { ...report, at: new Date().toISOString() };
      return report;
    }),
    state: (): { running: boolean; activity: typeof activity; last: LibrarySyncReport | null; lastError: string | null;
      lastImport: typeof lastImport; status: LibraryStatus } =>
      ({ running, activity, last, lastError, lastImport, status: store.status() }),
    close: () => { closing = true; clearTimeout(startTimer); clearTimeout(pokeTimer); clearInterval(interval); store.close(); },
  };
}

export type LibrarySync = ReturnType<typeof installLibrarySync>;

const uploadFile = (id: string) => path.join(IMPORT_DIR, `${id}.sqlite.part`);
const validId = (id: string) => /^[a-z0-9]{12,40}$/.test(id);

export function registerLibraryStorageRoutes(app: express.Express, sync: LibrarySync): void {
  app.get("/api/library/storage", (_req, res) => res.json({ ...sync.state(), chunkBytes: IMPORT_CHUNK_BYTES }));
  app.post("/api/library/storage/sync", async (_req, res) => {
    const report = await sync.run();
    res.json({ ...sync.state(), started: !!report });
  });

  // The whole Library as one file, to import into another dashboard.
  app.get("/api/library/export", async (_req, res) => {
    const file = path.join(os.tmpdir(), `ad-factory-library-${process.pid}-${Date.now()}.sqlite`);
    try {
      await sync.exportTo(file);
      const name = `ad-factory-library-${new Date().toISOString().slice(0, 10)}.sqlite`;
      res.download(file, name, () => fs.rm(file, { force: true }, () => {}));
    } catch (err) {
      fs.rm(file, { force: true }, () => {});
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Resumable upload: the browser sends the export in order, each piece at the offset the server already has.
  app.get("/api/library/import/:id", (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Invalid upload" });
    const f = uploadFile(req.params.id);
    res.json({ size: fs.existsSync(f) ? fs.statSync(f).size : 0 });
  });
  app.put("/api/library/import/:id", (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(400).json({ error: "Invalid upload" });
    const offset = Number(req.query.offset);
    const f = uploadFile(id);
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
    const have = fs.existsSync(f) ? fs.statSync(f).size : 0;
    if (!Number.isInteger(offset) || offset !== have) return res.status(409).json({ error: "Upload is out of step", size: have });
    if (have > MAX_IMPORT_BYTES) return res.status(413).json({ error: "Library file is too large" });
    let received = 0;
    let failed = false;
    const out = fs.createWriteStream(f, { flags: "a" });
    const fail = (status: number, message: string) => {
      if (failed) return;
      failed = true; req.unpipe(out); out.destroy();
      // Drop the partial piece so the next attempt starts at a clean offset.
      try { fs.truncateSync(f, have); } catch { /* file gone */ }
      if (!res.headersSent) res.status(status).json({ error: message, size: have });
    };
    req.on("data", (c: Buffer) => { received += c.length; if (received > IMPORT_CHUNK_BYTES * 2) fail(413, "Upload piece is too large"); });
    req.on("aborted", () => fail(400, "Upload interrupted"));
    out.on("error", (err) => fail(500, err.message));
    out.on("finish", () => { if (!failed) res.json({ size: have + received }); });
    req.pipe(out);
  });
  app.post("/api/library/import/:id/finish", async (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(400).json({ error: "Invalid upload" });
    const f = uploadFile(id);
    if (!fs.existsSync(f)) return res.status(404).json({ error: "Nothing was uploaded" });
    const size = fs.statSync(f).size;
    if (Number(req.body?.size) !== size) return res.status(409).json({ error: `Upload incomplete: ${size} of ${req.body?.size} bytes`, size });
    try {
      const report = await sync.importFrom(f);
      res.json({ report, ...sync.state() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      fs.rm(f, { force: true }, () => {});
    }
  });
  app.delete("/api/library/import/:id", (req, res) => {
    if (validId(req.params.id)) fs.rmSync(uploadFile(req.params.id), { force: true });
    res.json({ ok: true });
  });
}
