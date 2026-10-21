/**
 * Video Factory — one command to produce a finished ad.
 *
 *   pnpm factory <project-id>
 *   pnpm factory jun17_01 jun17_02 jun17_04
 *   pnpm factory --sync-broll   # refresh clips + catalog from ~/Downloads/B-Roll
 *
 * Defaults: ElevenLabs v3 → HeyGen lip-sync, semantic B-roll, ffmpeg render,
 * music 30%, captions ALL CAPS +30% size, 1.2× speed, output → video/final/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADS_DIR, agentClipPath, type ProjectMetadata } from "@ai-ads/core";
import { syncBrollClips, buildBrollCatalog } from "./broll.js";
import { loadMetadata, runProduce, saveMetadata } from "./produce.js";
import { config } from "./config.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const FACTORY_CAPTIONS = {
  presetId: "poppins-bold-italic-pop",
  fontSize: 88, // ~30% larger than 68
  bottomPercent: 42,
  background: "none" as const,
  uppercase: true,
};

export function patchForFactory(meta: ProjectMetadata): ProjectMetadata {
  return {
    ...meta,
    introMs: meta.introMs ?? 5000,
    outputSpeed: meta.outputSpeed ?? 1.2,
    muteAvatar: false,
    avatarVolume: 1,
    music: {
      enabled: true,
      file: meta.music?.file ?? "data/music/funk-bed.mp3",
      volume: 0.3,
      startOffsetMs: meta.music?.startOffsetMs,
      title: meta.music?.title,
      youtubeUrl: meta.music?.youtubeUrl,
    },
    captions: { ...FACTORY_CAPTIONS, ...meta.captions, presetId: FACTORY_CAPTIONS.presetId },
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
}

function clearMusicCache(id: string) {
  const out = path.join(ADS_DIR, id, "out");
  for (const f of ["music-bed.mp3", "music-bed.mp3.stamp"]) {
    const p = path.join(out, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

/** Runs one project through the factory settings (ElevenLabs, semantic B-roll, ffmpeg, ALL CAPS). */
export async function runFactoryJob(
  id: string,
  opts: { skipHeygen?: boolean; shuffleBroll?: boolean } = {},
): Promise<ProjectMetadata> {
  const meta = loadMetadata(id);
  if (!meta) throw new Error(`No metadata for ${id}`);

  const avatar = agentClipPath(id);
  const adAvatar = path.join(ADS_DIR, id, "main.mp4");
  if (!opts.skipHeygen && !fs.existsSync(avatar) && !fs.existsSync(adAvatar)) {
    console.warn(`[${id}] No cached avatar — will generate via ElevenLabs + HeyGen`);
  }

  saveMetadata(patchForFactory(meta));
  clearMusicCache(id);

  return runProduce(loadMetadata(id)!, {
    skipHeygen: opts.skipHeygen ?? false,
    elevenLabs: true,
    renderer: "ffmpeg",
    factory: true,
    semanticBroll: true,
    shuffleBroll: opts.shuffleBroll ?? false,
  });
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  if (process.argv.includes("--sync-broll") || args.length === 0) {
    console.log("\n=== B-roll sync from ~/Downloads/B-Roll ===");
    const n = syncBrollClips();
    console.log(`  Symlinked ${n} clips → data/broll/clips/`);
    console.log("  Building catalog + preview screenshots…");
    const total = await buildBrollCatalog();
    console.log(`  Catalog: ${total} clips with categories + previews\n`);
    if (args.length === 0 && !process.argv.some((a) => a.endsWith("_"))) {
      if (!process.argv.includes("--sync-broll")) {
        console.error("Usage: pnpm factory <project-id> [more-ids...]");
        console.error("       pnpm factory --sync-broll");
        process.exit(1);
      }
      return;
    }
  }

  if (!args.length) {
    console.error("Usage: pnpm factory <project-id> [more-ids...]");
    process.exit(1);
  }

  console.log("\n=== Video Factory ===");
  console.log(`  Voice: ElevenLabs ${config.elevenLabsModel()} → HeyGen lip-sync`);
  console.log("  B-roll: semantic match to script");
  console.log("  Music: 30% · Captions: ALL CAPS · Speed: 1.2×");
  console.log("  Render: ffmpeg → video/final/\n");

  const skipHeygen = process.argv.includes("--skip-heygen");
  const shuffleBroll = process.argv.includes("--shuffle-broll");
  for (const id of args) {
    console.log(`\n──────── ${id} ────────`);
    try {
      await runFactoryJob(id, { skipHeygen, shuffleBroll });
    } catch (e) {
      console.error(`[${id}] FAILED:`, e);
    }
  }

  console.log("\n=== Factory complete ===");
  for (const id of args) {
    console.log(`  video/final/${id}.mp4`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
