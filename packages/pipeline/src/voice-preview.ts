import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adDir, ensureDir, ProjectMetadata } from "@ai-ads/core";
import { loadMetadata, runProduce, saveMetadata } from "./produce.js";
import { resolveFfmpegBin } from "./ffmpeg-render.js";

const run = promisify(execFile);

/** Local waveform preview using an already generated voice; makes no paid API calls. */
async function main() {
  const sourceId = process.argv[2];
  if (!sourceId) throw new Error("Usage: pnpm voice-preview <project-id>");
  const source = loadMetadata(sourceId);
  if (!source) throw new Error(`Missing project ${sourceId}`);
  const audioPath = path.join(adDir(sourceId), "main.mp3");
  if (!fs.existsSync(audioPath)) throw new Error("Generate voice audio first");

  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid voice audio duration");

  const id = `${sourceId}_preview`;
  const dir = ensureDir(adDir(id));
  const now = new Date().toISOString();
  const meta = ProjectMetadata.parse({
    ...source,
    id,
    title: "Test Preview — Voice + Captions (No Avatar)",
    avatar: { heygenAvatarId: "", name: "Local waveform preview" },
    fullAvatar: true,
    aspectRatio: "9:16",
    outputSpeed: 1,
    muteAvatar: false,
    avatarVolume: 1,
    status: "draft",
    error: undefined,
    outputFile: undefined,
    createdAt: now,
    updatedAt: now,
  });
  saveMetadata(meta);

  let fontOption = "font=Arial";
  if (process.platform === "win32") {
    const fontPath = path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arial.ttf");
    fs.copyFileSync(fontPath, path.join(dir, "preview-font.ttf"));
    fontOption = "fontfile=preview-font.ttf";
  }

  const filters = [
    "[0:a]asplit=2[voice][wave]",
    "[wave]showwaves=s=900x220:mode=cline:colors=DodgerBlue:r=30[w]",
    "[1:v]drawbox=x=70:y=90:w=940:h=7:color=0x3B82F6:t=fill," +
      `drawtext=${fontOption}:fontsize=76:fontcolor=white:x=70:y=185:text='AI AD FACTORY',` +
      `drawtext=${fontOption}:fontsize=38:fontcolor=0x60A5FA:x=70:y=290:text='CLAUDE HAIKU 5.5',` +
      `drawtext=${fontOption}:fontsize=32:fontcolor=0xCBD5E1:x=70:y=370:text='German voice / captions / music',` +
      `drawtext=${fontOption}:fontsize=29:fontcolor=0x94A3B8:x=70:y=1770:text='LOCAL PREVIEW - NO TALKING AVATAR'[bg]`,
    "[bg][w]overlay=90:730[v]",
  ].join(";");
  const filterPath = path.join(dir, "preview-source.filter.txt");
  fs.writeFileSync(filterPath, filters);
  await run(resolveFfmpegBin(), [
    "-hide_banner", "-loglevel", "error", "-y", "-i", audioPath,
    "-f", "lavfi", "-i", `color=c=0x0F172A:s=1080x1920:r=30:d=${duration}`,
    "-filter_complex_script", filterPath, "-map", "[v]", "-map", "[voice]",
    "-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", path.join(dir, "main.mp4"),
  ], { cwd: dir, maxBuffer: 32 * 1024 * 1024 });

  // Caption timings are estimated if the original generation did not persist alignment.
  const tokens = meta.scriptDe.split(/\s+/).filter(Boolean);
  const total = tokens.reduce((sum, word) => sum + word.length + 1, 0);
  let cursor = 0;
  let words = tokens.map((word) => {
    const startMs = Math.round(cursor / total * duration * 1000);
    cursor += word.length + 1;
    return { word, startMs, endMs: Math.round(cursor / total * duration * 1000) };
  });
  const alignmentPath = audioPath.replace(/\.[^.]+$/, ".tts.json");
  if (fs.existsSync(alignmentPath)) {
    const tts = JSON.parse(fs.readFileSync(alignmentPath, "utf8"));
    if (tts.scriptDe === meta.scriptDe && tts.words?.length) {
      words = tts.words;
      console.log(`Using saved ${tts.timestampSource} caption timings (${tts.modelId})`);
    }
  }
  const outDir = ensureDir(path.join(dir, "out"));
  fs.writeFileSync(path.join(outDir, "render.props.json"), JSON.stringify({ segments: [{ words }] }));
  process.argv.push("--skip-heygen", "--renderer=ffmpeg");
  await runProduce(meta);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
