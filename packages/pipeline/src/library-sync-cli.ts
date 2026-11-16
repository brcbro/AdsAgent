import { LibraryStore } from "./library-store.js";

/** `pnpm library-sync`: store new Library files in the database and restore any missing from disk. */
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

async function main() {
  const store = new LibraryStore();
  try {
    console.log("Syncing the Library with the database…");
    const r = await store.sync();
    const s = store.status();
    console.log(`Stored ${r.stored} new, updated ${r.updated}, restored ${r.restored} to disk, followed ${r.moved} moves, ${r.unchanged} unchanged (${(r.durationMs / 1000).toFixed(1)} s).`);
    console.log(`In the database: ${s.byKind.broll.files} B-roll clips, ${s.byKind.preview.files} previews, ${s.byKind.music.files} music tracks, catalog ${s.byKind.catalog.files ? "yes" : "no"} — ${mb(s.bytes)} total.`);
    for (const f of r.tooLarge) console.warn(`Too large for the database (kept on disk only): ${f}`);
    for (const e of r.errors) console.warn(`Failed: ${e.path} — ${e.error}`);
    if (r.errors.length) process.exitCode = 1;
  } finally {
    store.close();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
