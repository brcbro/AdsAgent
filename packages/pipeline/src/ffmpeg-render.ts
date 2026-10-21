import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Beat, WordTimestamp } from "@ai-ads/core";
import {
  appendCtaArrowToAss,
  ctaButtonOverlayFilters,
  ctaTiming,
  CTA_DURATION_MS,
  CTA_TEXT,
  ensureCtaButtonPngs,
} from "./cta-overlay.js";

const run = promisify(execFile);
const FPS = 30;

export function resolveFfmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const full = "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg";
  if (fs.existsSync(full)) return full;
  return "ffmpeg";
}

export type FfmpegCaptionStyle = {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  stroke: string;
  shadow: string;
  bottomPercent: number;
  fontStyle?: string;
  mode: "phrase" | "word";
  uppercase?: boolean;
};

export type FfmpegRenderInput = {
  avatarPath: string;
  durationMs: number;
  beats: Beat[];
  words: WordTimestamp[];
  captionStyle: FfmpegCaptionStyle;
  avatarZoom: number;
  avatarVolume: number;
  muteAvatar: boolean;
  musicPath?: string;
  musicStartMs?: number;
  /** Lower the music bed while the voice speaks (default true). */
  duckMusic?: boolean;
  width: number;
  height: number;
  outFile: string;
  workDir: string;
  /** Show CTA button in last 4 seconds of final export (default true). */
  ctaEnabled?: boolean;
  outputSpeed?: number;
};

function msToAss(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hexToAssBgr(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "&H00FFFFFF";
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function assFontName(style: FfmpegCaptionStyle): string {
  if (/poppins/i.test(style.fontFamily)) {
    return style.fontStyle === "italic" ? "Arial Bold Italic" : "Arial Bold";
  }
  return style.fontWeight >= 700 ? "Arial Bold" : "Arial";
}

function outlinePx(stroke: string): number {
  const m = stroke.match(/(\d+)px/);
  return m ? parseInt(m[1], 10) : 0;
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function buildAss(words: WordTimestamp[], style: FfmpegCaptionStyle, height: number): string {
  const font = assFontName(style);
  const primary = hexToAssBgr(style.color);
  const outline = outlinePx(style.stroke);
  const marginV = Math.round(height * (style.bottomPercent / 100));
  const bold = style.fontWeight >= 700 ? -1 : 0;
  const italic = style.fontStyle === "italic" ? -1 : 0;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: ${height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,${font},${style.fontSize},${primary},&H000000FF,&H00000000,&H80000000,${bold},${italic},0,0,100,100,0,0,1,${outline},2,2,48,48,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  if (style.mode === "word") {
    for (const w of words) {
      const endMs = Math.max(w.endMs, w.startMs + 80);
      const text = style.uppercase ? w.word.toUpperCase() : w.word;
      lines.push(
        `Dialogue: 0,${msToAss(w.startMs)},${msToAss(endMs)},Pop,,0,0,0,,${escapeAss(text)}`,
      );
    }
  } else {
    const chunk = 5;
    for (let i = 0; i < words.length; i += chunk) {
      const slice = words.slice(i, i + chunk);
      if (!slice.length) continue;
      const startMs = slice[0].startMs;
      const endMs = slice[slice.length - 1].endMs;
      const text = style.uppercase
        ? slice.map((w) => w.word).join(" ").toUpperCase()
        : slice.map((w) => w.word).join(" ");
      lines.push(
        `Dialogue: 0,${msToAss(startMs)},${msToAss(endMs)},Pop,,0,0,0,,${escapeAss(text)}`,
      );
    }
  }

  return header + lines.join("\n") + "\n";
}

/** Scale/crop to fill frame; optional zoom on avatar segments. */
function fitFrame(w: number, h: number, zoom = 1): string {
  const zw = Math.round(w * zoom);
  const zh = Math.round(h * zoom);
  return `scale=${zw}:${zh}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},format=yuv420p,setsar=1`;
}

export async function renderWithFfmpeg(input: FfmpegRenderInput): Promise<string> {
  const {
    avatarPath,
    durationMs,
    beats,
    words,
    captionStyle,
    avatarZoom,
    avatarVolume,
    muteAvatar,
    musicPath,
    musicStartMs = 0,
    duckMusic = true,
    width,
    height,
    outFile,
    workDir,
    ctaEnabled = true,
    outputSpeed = 1,
  } = input;

  const skipCta = process.argv.includes("--no-cta") || ctaEnabled === false;

  fs.mkdirSync(workDir, { recursive: true });
  const ctaWorkDir = path.join(workDir, "cta");
  let ctaBlueIdx = 0;
  let ctaWhiteIdx = 0;
  let ctaTimingInfo = ctaTiming(durationMs, outputSpeed);

  const assPath = path.join(workDir, "captions.ass");
  let assContent = buildAss(words, captionStyle, height);
  if (!skipCta) {
    assContent = appendCtaArrowToAss(assContent, durationMs, height, captionStyle.bottomPercent, outputSpeed);
    console.log(`[ffmpeg] CTA last ${CTA_DURATION_MS / 1000}s — blue pill → click → white pill`);
  }
  fs.writeFileSync(assPath, assContent);

  const timeline = [...beats].sort((a, b) => a.startMs - b.startMs);
  const brollPaths = [...new Set(timeline.filter((b) => b.kind === "broll" && b.clipPath).map((b) => b.clipPath!))];
  const clipInputIdx = new Map<string, number>();
  brollPaths.forEach((p, i) => clipInputIdx.set(p, i + 1));

  const inputs: string[] = ["-y", "-i", avatarPath];
  for (const clipPath of brollPaths) inputs.push("-i", clipPath);
  const musicIdx = brollPaths.length + 1;
  if (musicPath) inputs.push("-i", musicPath);

  let nextInputIdx = brollPaths.length + 1 + (musicPath ? 1 : 0);
  let ctaBluePath: string | undefined;
  let ctaWhitePath: string | undefined;
  if (!skipCta) {
    const pngs = await ensureCtaButtonPngs(ctaWorkDir);
    ctaBluePath = pngs.blue;
    ctaWhitePath = pngs.white;
    inputs.push("-i", ctaBluePath, "-i", ctaWhitePath);
    ctaBlueIdx = nextInputIdx;
    ctaWhiteIdx = nextInputIdx + 1;
  }

  const durSec = durationMs / 1000;
  const fitAvatar = fitFrame(width, height, avatarZoom);
  const fitBroll = fitFrame(width, height, 1);

  const segLabels: string[] = [];
  const filters: string[] = [];

  timeline.forEach((beat, i) => {
    const seg = `seg${i}`;
    segLabels.push(`[${seg}]`);
    const dur = ((beat.endMs - beat.startMs) / 1000).toFixed(3);
    if (beat.kind === "broll" && beat.clipPath) {
      const idx = clipInputIdx.get(beat.clipPath)!;
      const clipStart = ((beat.clipInMs ?? 0) / 1000).toFixed(3);
      filters.push(
        `[${idx}:v]trim=start=${clipStart}:duration=${dur},setpts=PTS-STARTPTS,${fitBroll}[${seg}]`,
      );
    } else {
      const start = (beat.startMs / 1000).toFixed(3);
      filters.push(
        `[0:v]trim=start=${start}:duration=${dur},setpts=PTS-STARTPTS,${fitAvatar}[${seg}]`,
      );
    }
  });

  filters.push(`${segLabels.join("")}concat=n=${segLabels.length}:v=1:a=0[vcat]`);

  const assEsc = `'${assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`;
  filters.push(`[vcat]ass=filename=${assEsc}[vsub]`);
  if (!skipCta && ctaBluePath && ctaWhitePath) {
    filters.push(
      ...ctaButtonOverlayFilters(
        "vsub",
        "vout",
        ctaBlueIdx,
        ctaWhiteIdx,
        width,
        height,
        captionStyle.bottomPercent,
        ctaTimingInfo,
      ),
    );
  } else {
    filters.push("[vsub]copy[vout]");
  }

  const audioFilters: string[] = [];
  if (muteAvatar) {
    if (musicPath) {
      audioFilters.push(
        `[${musicIdx}:a]atrim=start=${(musicStartMs / 1000).toFixed(3)}:duration=${durSec.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
      );
    }
  } else if (musicPath) {
    audioFilters.push(
      `[${musicIdx}:a]atrim=start=${(musicStartMs / 1000).toFixed(3)}:duration=${durSec.toFixed(3)},asetpts=PTS-STARTPTS[vm]`,
    );
    if (duckMusic) {
      // The voice feeds both the mix and the sidechain that ducks the music under it.
      audioFilters.push(`[0:a]volume=${avatarVolume.toFixed(2)},asplit=2[va][vsc]`);
      audioFilters.push("[vm][vsc]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=400[vmd]");
    } else {
      audioFilters.push(`[0:a]volume=${avatarVolume.toFixed(2)}[va]`);
      audioFilters.push("[vm]anull[vmd]");
    }
    audioFilters.push("[va][vmd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]");
  } else {
    audioFilters.push(`[0:a]volume=${avatarVolume.toFixed(2)}[aout]`);
  }

  const filterScript = path.join(workDir, "filter.txt");
  fs.writeFileSync(filterScript, [...filters, ...audioFilters].join(";"));

  const args = [
    ...inputs,
    "-filter_complex_script",
    filterScript,
    "-map",
    "[vout]",
    "-map",
    muteAvatar && !musicPath ? "0:a?" : "[aout]",
    "-t",
    durSec.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outFile,
  ];

  if (muteAvatar && !musicPath) {
    const mapIdx = args.indexOf("-map");
    args.splice(mapIdx, 2);
    args.push("-an");
  }

  const brollCount = timeline.filter((b) => b.kind === "broll").length;
  console.log(`[ffmpeg] Concat ${timeline.length} segments (${brollCount} B-roll video cuts) + captions…`);
  const t0 = Date.now();
  await run(resolveFfmpegBin(), args, { maxBuffer: 128 * 1024 * 1024 });
  console.log(`[ffmpeg] Done (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return outFile;
}
