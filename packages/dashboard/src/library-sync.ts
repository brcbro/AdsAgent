import type express from "express";
import { LibraryStore, type LibraryStatus, type LibrarySyncReport } from "@ai-ads/pipeline";

/*
 * Keeps the Library (B-roll clips, previews, catalog, music) stored in the database.
 * On start it restores anything missing on disk and stores anything new; then it re-syncs every
 * 10 minutes and shortly after uploads, imports, category changes and classifier runs.
 * One sync at a time; a request that arrives mid-sync runs once more afterwards.
 */

const START_DELAY_MS = 3_000;
const INTERVAL_MS = 10 * 60_000;
const POKE_DELAY_MS = 15_000;

export function installLibrarySync() {
  const store = new LibraryStore();
  let running = false;
  let again = false;
  let closing = false;
  let last: LibrarySyncReport | null = null;
  let lastError: string | null = null;
  let pokeTimer: NodeJS.Timeout | undefined;

  async function run(): Promise<LibrarySyncReport | null> {
    if (closing) return null;
    if (running) { again = true; return null; }
    running = true;
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
    } finally {
      running = false;
      if (again && !closing) { again = false; void run(); }
    }
  }

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
    state: (): { running: boolean; last: LibrarySyncReport | null; lastError: string | null; status: LibraryStatus } =>
      ({ running, last, lastError, status: store.status() }),
    close: () => { closing = true; clearTimeout(startTimer); clearTimeout(pokeTimer); clearInterval(interval); store.close(); },
  };
}

export type LibrarySync = ReturnType<typeof installLibrarySync>;

export function registerLibraryStorageRoutes(app: express.Express, sync: LibrarySync): void {
  app.get("/api/library/storage", (_req, res) => res.json(sync.state()));
  app.post("/api/library/storage/sync", async (_req, res) => {
    const report = await sync.run();
    res.json({ ...sync.state(), started: !!report });
  });
}
