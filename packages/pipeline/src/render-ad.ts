import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Segment,
  ProjectMetadata,
  DEFAULT_MUSIC,
  getCaptionPreset,
  REMOTION_DIR,
  REMOTION_PUBLIC_ADS,
  REPO_ROOT,
  adDir,
  ensureDir,
} from "@ai-ads/core";
import { renderWithFfmpeg } from "./ffmpeg-render.js";

const run = promisify(execFile);

export type RenderOptions = {
  skipHeygen: boolean;
  /** Factory mode uppercases captions. */
  factory: boolean;
  /** Persist metadata mid-render (music start offset is chosen here). */
  save: (meta: ProjectMetadata) => void;
};

async function musicDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return Math.round(parseFloat(stdout.trim()) * 1000);
}

function randomMusicStart(songMs: number, videoMs: number): number {
  const maxStart = Math.max(0, songMs - videoMs - 5000);
  if (maxStart <= 0) return Math.floor(Math.random() * Math.max(songMs * 0.3, 1000));
  return Math.floor(Math.random() * maxStart);
}

/** Re-encode the finished video at a new speed, keeping audio in sync. */
export async function applyOutputSpeed(filePath: string, speed: number): Promise<string> {
  const tmp = filePath.replace(/\.mp4$/, ".speed.mp4");
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "a",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0", filePath,
  ]).catch(() => ({ stdout: "" }));
  const hasAudio = stdout.trim().includes("audio");
  const args = [
    "-y", "-i", filePath,
    "-filter:v", `setpts=PTS/${speed}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
  ];
  if (hasAudio) {
    args.push("-filter:a", `atempo=${speed}`, "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(tmp);
  await run("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
  fs.renameSync(tmp, filePath);
  return filePath;
}

export async function renderAd(
  meta: ProjectMetadata,
  seg: Segment,
  renderer: "remotion" | "ffmpeg",
  opts: RenderOptions,
): Promise<string> {
  const music = { ...DEFAULT_MUSIC, ...meta.music };
  const publicDir = path.join(REMOTION_PUBLIC_ADS, meta.id);
  if (renderer === "remotion") {
    if (!opts.skipHeygen && fs.existsSync(publicDir)) {
      fs.rmSync(publicDir, { recursive: true, force: true });
    }
    ensureDir(publicDir);
  }
  const preset = getCaptionPreset(meta.captions?.presetId ?? "meta-clean");
  const captionStyle = {
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    fontSize: meta.captions?.fontSize ?? preset.fontSize,
    color: meta.captions?.color ?? preset.color,
    activeColor: preset.activeColor ?? meta.captions?.color ?? preset.color,
    stroke: preset.stroke,
    shadow: preset.shadow,
    bottomPercent: meta.captions?.bottomPercent ?? preset.bottomPercent,
    background:
      meta.captions?.background === "none"
        ? undefined
        : meta.captions?.background ?? preset.background,
    letterSpacing: preset.letterSpacing,
    fontStyle: preset.fontStyle,
    popIn: preset.popIn,
    mode: preset.mode,
    phraseWords: preset.phraseWords,
    uppercase:
      (meta.captions as { uppercase?: boolean })?.uppercase === true || opts.factory,
  };

  const noCaptions = meta.captions?.presetId === "none";
  let musicStartMs = music.startOffsetMs;
  const videoMs = seg.durationMs ?? 30000;
  const musicVol = music.enabled ? Math.max(0, Math.min(1, music.volume ?? 0.2)) : 0;

  const outDir = ensureDir(path.join(adDir(meta.id), "out"));
  const outFile = path.join(outDir, "final.mp4");

  let stagedMusicPath: string | undefined;
  if (music.enabled) {
    const absMusic = path.join(REPO_ROOT, music.file);
    if (fs.existsSync(absMusic)) {
      const musicDir = renderer === "ffmpeg" ? outDir : publicDir;
      ensureDir(musicDir);
      stagedMusicPath = path.join(musicDir, "music-bed.mp3");
      await stageMusicTo(absMusic, stagedMusicPath, musicVol);
      if (musicStartMs === undefined) {
        const songMs = await musicDurationMs(absMusic);
        musicStartMs = randomMusicStart(songMs, videoMs);
        meta.music = { ...music, startOffsetMs: musicStartMs };
        opts.save(meta);
      }
      console.log(
        `[${meta.id}] Music bed normalized + ${Math.round(musicVol * 100)}% (voice stays primary)`,
      );
    }
  }

  if (renderer === "ffmpeg") {
    const aspect = meta.aspectRatio ?? "16:9";
    const [width, height] = aspect === "9:16" ? [1080, 1920] : [1920, 1080];
    fs.writeFileSync(
      path.join(outDir, "render.props.json"),
      JSON.stringify(
        {
          renderer: "ffmpeg",
          segments: [{ id: seg.id, durationMs: videoMs, words: seg.words, beats: seg.beats }],
          musicStartMs: musicStartMs ?? 0,
          captionStyle,
          avatarZoom: meta.avatarZoom ?? 1,
          muteAvatar: meta.muteAvatar ?? false,
          avatarVolume: meta.avatarVolume ?? 1.4,
          aspectRatio: aspect,
        },
        null,
        2,
      ),
    );
    console.log(`[${meta.id}] ffmpeg render...`);
    await renderWithFfmpeg({
      avatarPath: seg.avatarPath!,
      durationMs: videoMs,
      beats: seg.beats,
      words: noCaptions ? [] : (seg.words ?? []),
      captionStyle,
      avatarZoom: meta.avatarZoom ?? 1,
      avatarVolume: meta.avatarVolume ?? 1.4,
      muteAvatar: meta.muteAvatar ?? false,
      musicPath: stagedMusicPath,
      musicStartMs: musicStartMs ?? 0,
      duckMusic: meta.music?.duck !== false,
      width,
      height,
      outFile,
      workDir: path.join(outDir, "ffmpeg-work"),
      outputSpeed: meta.outputSpeed ?? 1,
    });
    return outFile;
  }

  const props = {
    segments: [
      {
        id: seg.id,
        durationMs: videoMs,
        avatarSrc: stage(seg.avatarPath!, publicDir, meta.id),
        words: noCaptions ? [] : (seg.words ?? []),
        beats: seg.beats.map((b) => ({
          ...b,
          clipPath: b.clipPath ? stage(b.clipPath, publicDir, meta.id) : undefined,
        })),
      },
    ],
    musicSrc: stagedMusicPath ? stage(stagedMusicPath, publicDir, meta.id, "music-bed.mp3") : undefined,
    musicVolume: stagedMusicPath ? 1 : 0,
    musicStartMs: musicStartMs ?? 0,
    captionStyle,
    avatarZoom: meta.avatarZoom ?? 1,
    muteAvatar: meta.muteAvatar ?? false,
    avatarVolume: meta.avatarVolume ?? 1.4,
    aspectRatio: meta.aspectRatio ?? "16:9",
  };

  fs.writeFileSync(path.join(outDir, "render.props.json"), JSON.stringify(props, null, 2));

  console.log(`[${meta.id}] Remotion render...`);
  const concurrency = Math.max(2, Math.min(os.cpus().length, 8));
  await run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "remotion", "render", "src/index.ts", "AdComposition", outFile,
      `--props=${path.join(outDir, "render.props.json")}`,
      `--concurrency=${concurrency}`,
    ],
    { cwd: REMOTION_DIR, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
  );
  return outFile;
}

function stage(absPath: string, publicDir: string, adId: string, destName?: string): string {
  const base = destName ?? path.basename(absPath);
  const dest = path.join(publicDir, base);
  if (!fs.existsSync(dest) || fs.statSync(absPath).mtimeMs > fs.statSync(dest).mtimeMs) {
    fs.copyFileSync(absPath, dest);
  }
  return `ads/${adId}/${base}`;
}

/** Normalize hot music beds to ~-24 LUFS, then apply user volume so 20% sits under voice. */
async function stageMusicTo(absPath: string, dest: string, volume: number): Promise<void> {
  const stampPath = `${dest}.stamp`;
  const cacheKey = `${volume.toFixed(3)}-${fs.statSync(absPath).mtimeMs}`;
  if (fs.existsSync(dest) && fs.existsSync(stampPath) && fs.readFileSync(stampPath, "utf-8") === cacheKey) {
    return;
  }
  await run(
    "ffmpeg",
    [
      "-y", "-i", absPath,
      "-af", `loudnorm=I=-24:TP=-2:LRA=11,volume=${volume.toFixed(4)}`,
      "-c:a", "libmp3lame", "-q:a", "4",
      dest,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  fs.writeFileSync(stampPath, cacheKey);
}
