import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { resolveFfmpegBin } from "./ffmpeg-render.js";

const run = promisify(execFile);

export const CTA_TEXT = "Klicke unten auf den Link!";
export const CTA_DURATION_MS = 4000;

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");
const BTN_W = 900;
const BTN_H = 96;

export type CtaTiming = {
  startSec: number;
  clickSec: number;
  endSec: number;
};

export function ctaTiming(durationMs: number, outputSpeed = 1): CtaTiming {
  const endSec = durationMs / 1000;
  const windowSec = (CTA_DURATION_MS * outputSpeed) / 1000;
  const startSec = Math.max(0, endSec - windowSec);
  return { startSec, clickSec: startSec + 1.5, endSec };
}

/** Y coordinate (from top) for button overlay — sits below karaoke captions. */
export function ctaButtonTop(height: number, captionBottomPercent: number): number {
  const captionMargin = Math.round(height * (captionBottomPercent / 100));
  const gapBelowCaption = 100;
  return height - captionMargin - gapBelowCaption - BTN_H;
}

export function ctaButtonLeft(width: number): number {
  return Math.round((width - BTN_W) / 2);
}

async function rasterizeSvg(svgPath: string, pngPath: string): Promise<void> {
  if (fs.existsSync(pngPath) && fs.statSync(pngPath).mtimeMs >= fs.statSync(svgPath).mtimeMs) {
    return;
  }
  if (process.platform === "win32") {
    const renderer = new Resvg(fs.readFileSync(svgPath), {
      fitTo: { mode: "width", value: BTN_W },
    });
    fs.writeFileSync(pngPath, renderer.render().asPng());
    return;
  }
  const rsvg = "/opt/homebrew/bin/rsvg-convert";
  if (fs.existsSync(rsvg)) {
    await run(rsvg, ["-w", String(BTN_W), "-h", String(BTN_H), "-o", pngPath, svgPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return;
  }
  const ffmpeg = resolveFfmpegBin();
  try {
    await run(ffmpeg, ["-y", "-i", svgPath, "-frames:v", "1", pngPath], { maxBuffer: 16 * 1024 * 1024 });
    return;
  } catch {
    /* ffmpeg may lack SVG support */
  }
  if (process.platform === "darwin") {
    const outDir = path.dirname(pngPath);
    await run("qlmanage", ["-t", "-s", "1800", "-o", outDir, svgPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const thumb = path.join(outDir, `${path.basename(svgPath)}.png`);
    if (fs.existsSync(thumb)) {
      fs.renameSync(thumb, pngPath);
      return;
    }
  }
  throw new Error(`Cannot rasterize ${svgPath} — install librsvg or use macOS qlmanage`);
}

/** Cache blue + white pill PNGs in workDir. */
export async function ensureCtaButtonPngs(workDir: string): Promise<{ blue: string; white: string }> {
  fs.mkdirSync(workDir, { recursive: true });
  const blueSvg = path.join(ASSETS, "cta-btn-blue.svg");
  const whiteSvg = path.join(ASSETS, "cta-btn-white.svg");
  const blue = path.join(workDir, "cta-btn-blue.png");
  const white = path.join(workDir, "cta-btn-white.png");
  await rasterizeSvg(blueSvg, blue);
  await rasterizeSvg(whiteSvg, white);
  return { blue, white };
}

function msToAss(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Arrow-only ASS events (button is PNG overlay). */
export function appendCtaArrowToAss(
  assContent: string,
  durationMs: number,
  height: number,
  captionBottomPercent: number,
  outputSpeed = 1,
): string {
  const { startSec, clickSec, endSec } = ctaTiming(durationMs, outputSpeed);
  const startMs = startSec * 1000;
  const clickMs = clickSec * 1000;

  const btnTop = ctaButtonTop(height, captionBottomPercent);
  const centerX = 540;
  const arrowStartY = btnTop - 90;
  const arrowEndY = btnTop - 18;

  const ctaStyleLines = `Style: CtaArrow,Arial Bold,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1
`;

  const eventsHeader = assContent.indexOf("[Events]");
  if (eventsHeader < 0) return assContent;

  const withStyles =
    assContent.slice(0, eventsHeader) + ctaStyleLines + assContent.slice(eventsHeader);

  const arrowMove = `{\\move(${centerX},${arrowStartY},${centerX},${arrowEndY},0,1200)\\fad(150,250)}`;

  const events = `Dialogue: 1,${msToAss(startMs + 300)},${msToAss(clickMs + 200)},CtaArrow,,0,0,0,,${arrowMove}▼`;

  return `${withStyles.trimEnd()}\n${events}\n`;
}

/** ffmpeg overlay filters: blue button → click → white button. */
export function ctaButtonOverlayFilters(
  videoIn: string,
  videoOut: string,
  blueIdx: number,
  whiteIdx: number,
  width: number,
  height: number,
  captionBottomPercent: number,
  timing: CtaTiming,
): string[] {
  const x = ctaButtonLeft(width);
  const y = ctaButtonTop(height, captionBottomPercent);
  const { startSec, clickSec, endSec } = timing;

  return [
    `[${blueIdx}:v]scale=${BTN_W}:${BTN_H}[ctablue]`,
    `[${whiteIdx}:v]scale=${BTN_W}:${BTN_H}[ctawhite]`,
    `[${videoIn}][ctablue]overlay=${x}:${y}:enable='between(t,${startSec.toFixed(3)},${clickSec.toFixed(3)})'[cta1]`,
    `[cta1][ctawhite]overlay=${x}:${y}:enable='between(t,${clickSec.toFixed(3)},${endSec.toFixed(3)})'[${videoOut}]`,
  ];
}
