import { syncBrollClips, buildBrollCatalog } from "./broll.js";

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
  console.log("Usage: broll-index.ts sync | catalog [limit]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
