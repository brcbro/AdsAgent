import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Beat,
  Segment,
  REMOTION_DIR,
  REMOTION_PUBLIC_ADS,
  BROLL_DIR,
  adDir,
  ensureDir,
  estimateDurationMs,
} from "@ai-ads/core";
import { synthesize } from "./elevenlabs.js";
import { generateAvatarClip } from "./heygen.js";
import { publishToVideoFolder } from "./publish.js";

const run = promisify(execFile);

// Single-test ad: one ~30s German script → ElevenLabs → HeyGen avatar.
// Avatar visible for 5 or 7s, then b-roll covers the rest while voice continues.
const SCRIPT_DE =
  "Die meisten Trader scheitern, weil sie ohne System handeln. Kein Plan, kein Risikomanagement — nur Bauchgefühl. Genau hier setzen wir an: strukturiertes Trading lernen, Schritt für Schritt. Charts lesen, Einstiege timen, Verluste begrenzen. Kein Finfluencer-Hype — echtes Handwerk. Bereit, endlich mit einem klaren System zu starten? Link in der Bio.";

async function main() {
  const skipHeygen = process.argv.includes("--skip-heygen");
  const introMs = [5000, 7000][Math.floor(Math.random() * 2)];
  const adId = `test_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}`;
  const dir = ensureDir(adDir(adId));

  console.log(`\n=== Test Ad: ${adId} ===`);
  console.log(`Avatar sichtbar: ${introMs / 1000}s, danach nur B-Roll\n`);
  console.log(`Skript:\n${SCRIPT_DE}\n`);

  const seg: Segment = {
    id: "main",
    role: "body",
    scriptDe: SCRIPT_DE,
    estimatedMs: estimateDurationMs(SCRIPT_DE),
    beats: [],
  };

  const audioPath = path.join(dir, "main.mp3");
  console.log("ElevenLabs TTS...");
  const tts = await synthesize(SCRIPT_DE, audioPath);
  seg.audioPath = audioPath;
  seg.durationMs = tts.durationMs;
  seg.words = tts.words;
  console.log(`Audio: ${(tts.durationMs / 1000).toFixed(1)}s\n`);

  const avatarPath = path.join(dir, "main.mp4");
  if (skipHeygen && fs.existsSync(avatarPath)) {
    console.log("Skipping HeyGen (--skip-heygen, using existing avatar)\n");
  } else {
    console.log("HeyGen avatar (~30s)...");
    await generateAvatarClip(audioPath, avatarPath, {
      onStatus: (s) => process.stdout.write(`\rHeyGen: ${s}        `),
    });
    console.log("\n");
  }
  seg.avatarPath = avatarPath;

  seg.beats = planMontageBeats(seg, introMs);
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify({ introMs, beats: seg.beats }, null, 2));

  await renderSingle(adId, seg);
  const renderPath = path.join(dir, "out", "test.mp4");
  const videoDir = publishToVideoFolder(adId, renderPath);
  console.log(`\nDone → ${renderPath}`);
  console.log(`Published → ${videoDir}`);
}

function planMontageBeats(seg: Segment, introMs: number): Beat[] {
  const clips = listBrollClips();
  const dur = seg.durationMs ?? seg.estimatedMs ?? 30000;
  const beats: Beat[] = [{ startMs: 0, endMs: Math.min(introMs, dur), kind: "talking_head" }];

  if (clips.length === 0) {
    beats.push({ startMs: introMs, endMs: dur, kind: "talking_head" });
    return beats;
  }

  let t = Math.min(introMs, dur);
  let cursor = 0;
  const cutMs = 1800; // fast-paced ~1.8s per clip
  while (t < dur) {
    const end = Math.min(t + cutMs, dur);
    const clip = clips[cursor++ % clips.length];
    beats.push({ startMs: t, endMs: end, kind: "broll", clipPath: clip, clipInMs: 0 });
    t = end;
  }
  return beats;
}

function listBrollClips(): string[] {
  const roots = [path.join(BROLL_DIR, "clips"), BROLL_DIR];
  const clips: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === "previews") continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(mp4|mov|webm)$/i.test(name)) clips.push(p);
    }
  };
  for (const root of roots) walk(root);
  return clips.sort();
}

async function renderSingle(adId: string, seg: Segment): Promise<void> {
  console.log("Remotion render...");
  const publicDir = ensureDir(path.join(REMOTION_PUBLIC_ADS, adId));
  const props = {
    segments: [
      {
        id: seg.id,
        durationMs: seg.durationMs ?? seg.estimatedMs ?? 30000,
        avatarSrc: stage(seg.avatarPath!, publicDir, adId),
        words: seg.words ?? [],
        beats: seg.beats.map((b) => ({
          ...b,
          clipPath: b.clipPath ? stage(b.clipPath, publicDir, adId) : undefined,
        })),
      },
    ],
  };

  const outDir = ensureDir(path.join(adDir(adId), "out"));
  const propsFile = path.join(outDir, "test.props.json");
  fs.writeFileSync(propsFile, JSON.stringify(props, null, 2));

  await run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "remotion", "render", "src/index.ts", "AdComposition",
      path.join(outDir, "test.mp4"),
      `--props=${propsFile}`,
    ],
    { cwd: REMOTION_DIR, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" },
  );
}

function stage(absPath: string, publicDir: string, adId: string): string {
  const dest = path.join(publicDir, path.basename(absPath));
  if (!fs.existsSync(dest)) fs.copyFileSync(absPath, dest);
  return `ads/${adId}/${path.basename(absPath)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
