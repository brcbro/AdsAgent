import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_MUSIC_FILE,
  ensureMusicDir,
  MUSIC_TRACKS,
  REPO_ROOT,
} from "@ai-ads/core";

const run = promisify(execFile);

async function downloadTrack(outPath: string, track: (typeof MUSIC_TRACKS)[number]): Promise<void> {
  const tmp = outPath.replace(/\.mp3$/, ".%(ext)s");
  const source = track.youtubeUrl && track.id === "funk-abnormal"
    ? track.youtubeUrl
    : `ytsearch1:${track.searchQuery}`;
  await run(
    "yt-dlp",
    ["-x", "--audio-format", "mp3", "--no-playlist", "-o", tmp, source],
    { timeout: 180_000 },
  );
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, ".mp3");
  const downloaded = fs.readdirSync(dir).find((f) => f.startsWith(base) && f.endsWith(".mp3"));
  if (downloaded && downloaded !== path.basename(outPath)) {
    fs.renameSync(path.join(dir, downloaded), outPath);
  }
}

async function copyLocalFallback(outPath: string): Promise<boolean> {
  const local = path.join(
    process.env.HOME ?? "",
    "Downloads",
    "DJ V12 - FUNK ABNORMAL (ULTRA SLOWED).mp3",
  );
  if (!fs.existsSync(local)) return false;
  fs.copyFileSync(local, outPath);
  return true;
}

async function main(): Promise<void> {
  ensureMusicDir();
  console.log(`Syncing ${MUSIC_TRACKS.length} phonk tracks → data/music/\n`);

  for (const track of MUSIC_TRACKS) {
    const outPath = path.join(REPO_ROOT, track.file);
    if (fs.existsSync(outPath)) {
      console.log(`✓ ${track.title}`);
      continue;
    }

    process.stdout.write(`↓ ${track.title}… `);
    try {
      if (track.id === "funk-abnormal" && (await copyLocalFallback(outPath))) {
        console.log("copied from Downloads");
        continue;
      }
      await downloadTrack(outPath, track);
      console.log("done");
    } catch (e) {
      console.log(`failed (${(e as Error).message?.slice(0, 60) ?? "error"})`);
    }
  }

  const legacy = path.join(REPO_ROOT, "data/music/funk-bed.mp3");
  const primary = path.join(REPO_ROOT, DEFAULT_MUSIC_FILE);
  if (fs.existsSync(primary) && !fs.existsSync(legacy)) {
    fs.copyFileSync(primary, legacy);
    console.log("\nLinked funk-bed.mp3 → default track");
  }

  const ready = MUSIC_TRACKS.filter((t) => fs.existsSync(path.join(REPO_ROOT, t.file))).length;
  console.log(`\n${ready}/${MUSIC_TRACKS.length} tracks ready`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
