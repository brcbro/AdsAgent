import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adDir, ensureDir, type ProjectMetadata } from "@ai-ads/core";
import { resolveFfmpegBin } from "./ffmpeg-render.js";

const run = promisify(execFile);

/** Build a local source with narration and saved caption timings, without an avatar API. */
export async function prepareVoicePreviewSource(meta: ProjectMetadata, audioPath: string): Promise<void> {
  const dir = ensureDir(adDir(meta.id));
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid voice audio duration");

  let fontOption = "font=Arial";
  if (process.platform === "win32") {
    fs.copyFileSync(path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arial.ttf"), path.join(dir, "preview-font.ttf"));
    fontOption = "fontfile=preview-font.ttf";
  }
  const portrait = meta.aspectRatio === "9:16";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const filters = [
    "[0:a]asplit=2[voice][wave]",
    `[wave]showwaves=s=${width - 180}x220:mode=cline:colors=DodgerBlue:r=30[w]`,
    `[1:v]drawbox=x=70:y=90:w=${width - 140}:h=7:color=0x3B82F6:t=fill,` +
      `drawtext=${fontOption}:fontsize=76:fontcolor=white:x=70:y=185:text='LOCAL PREVIEW',` +
      `drawtext=${fontOption}:fontsize=38:fontcolor=0x60A5FA:x=70:y=290:text='ELEVENLABS GERMAN VOICE',` +
      `drawtext=${fontOption}:fontsize=32:fontcolor=0xCBD5E1:x=70:y=370:text='B-roll / captions / music',` +
      `drawtext=${fontOption}:fontsize=29:fontcolor=0x94A3B8:x=70:y=${height - 150}:text='NO TALKING AVATAR'[bg]`,
    `[bg][w]overlay=90:${portrait ? 730 : 540}[v]`,
  ].join(";");
  const filterPath = path.join(dir, "preview-source.filter.txt");
  fs.writeFileSync(filterPath, filters);
  await run(resolveFfmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", "-i", audioPath,
    "-f", "lavfi", "-i", `color=c=0x0F172A:s=${width}x${height}:r=30:d=${duration}`,
    "-filter_complex_script", filterPath, "-map", "[v]", "-map", "[voice]",
    "-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path.join(dir, "main.mp4")],
  { cwd: dir, maxBuffer: 32 * 1024 * 1024 });

  const tokens = meta.scriptDe.split(/\s+/).filter(Boolean);
  const total = tokens.reduce((sum, word) => sum + word.length + 1, 0);
  let cursor = 0;
  let words = tokens.map(word => {
    const startMs = Math.round(cursor / total * duration * 1000);
    cursor += word.length + 1;
    return { word, startMs, endMs: Math.round(cursor / total * duration * 1000) };
  });
  const alignmentPath = audioPath.replace(/\.[^.]+$/, ".tts.json");
  if (fs.existsSync(alignmentPath)) {
    const tts = JSON.parse(fs.readFileSync(alignmentPath, "utf8"));
    if (tts.scriptDe === meta.scriptDe && tts.words?.length) words = tts.words;
  }
  fs.writeFileSync(path.join(ensureDir(path.join(dir, "out")), "render.props.json"),
    JSON.stringify({ segments: [{ words }] }));
}
