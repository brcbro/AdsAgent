import { syncBrollClips, buildBrollCatalog } from "./broll.js";
import { runBrollIngest } from "./broll-classify.js";

const cmd = process.argv[2] ?? "sync";

async function main() {
  if (cmd === "sync") {
    const n = syncBrollClips();
    console.log(`Linked ${n} B-roll clips → data/broll/clips/`);
    return;
  }
  if (cmd === "catalog") {
    const limit = process.argv[3] ? Number(process.argv[3]) : undefined;
    console.log("Building B-roll screenshot catalog…");
    const n = await buildBrollCatalog(limit);
    console.log(`Catalog: ${n} clips → data/broll/catalog.json`);
    return;
  }
  if (cmd === "classify") {
    console.log("Classifying unclassified B-roll (inbox, new files, unsorted)…");
    const state = await runBrollIngest({ log: (line) => console.log(line) });
    console.log(state.lastResult ?? "Nothing to do");
    for (const e of state.errors) console.log(`  ${e.file}: ${e.message}`);
    return;
  }
  console.log("Usage: broll-index.ts sync | catalog [limit] | classify");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
