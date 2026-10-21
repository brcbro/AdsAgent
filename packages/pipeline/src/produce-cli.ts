import { loadMetadata, runProduce, saveMetadata } from "./produce.js";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const id = args[0];
  if (!id) {
    console.error("Usage: pnpm produce <project-id> [--skip-heygen] [--renderer=ffmpeg]");
    process.exit(1);
  }
  const meta = loadMetadata(id);
  if (!meta) {
    console.error(`No metadata for video/${id}/metadata.json`);
    process.exit(1);
  }
  await runProduce(meta);
}

main().catch((e) => {
  const id = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  const meta = id ? loadMetadata(id) : null;
  if (meta) {
    meta.status = "error";
    meta.error = e instanceof Error ? e.message : String(e);
    meta.updatedAt = new Date().toISOString();
    saveMetadata(meta);
  }
  console.error(e);
  process.exit(1);
});
