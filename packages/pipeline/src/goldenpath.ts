import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  AdProject,
  Beat,
  Segment,
  REMOTION_DIR,
  REMOTION_PUBLIC_ADS,
  BROLL_DIR,
  adDir,
  ensureDir,
  estimateDurationMs,
  loadBriefing,
  saveProject,
  VIDEO_DIR,
} from "@ai-ads/core";
import { PerformanceStore, loadKbForPrompt } from "@ai-ads/performance";
import { generateScripts, describeScripts, type ScriptSet } from "./scriptgen.js";

function loadWinningPatterns(): string {
  let perf: PerformanceStore | undefined;
  try { perf = new PerformanceStore(); return loadKbForPrompt(perf); } catch { return ""; } finally { perf?.close(); }
}
import { synthesize } from "./elevenlabs.js";
import { generateAvatarClip } from "./heygen.js";
import { askApproval } from "./approve.js";
import { publishToVideoFolder } from "./publish.js";

const run = promisify(execFile);

// Golden path (Phase 0): briefing JSON -> scripts -> terminal approval ->
// ElevenLabs audio -> HeyGen avatar -> beat plan with local b-roll ->
// Remotion render. Generates ONE hook and ONE cta by default to limit spend;
// pass --all to generate every concept in the briefing.
async function main() {
  const args = process.argv.slice(2);
  const briefingPath = args.find((a) => !a.startsWith("--"));
  const all = args.includes("--all");
  // --yes skips the interactive script gate — for non-interactive runs only;
  // the generated scripts still land in scripts.json for review.
  const autoApprove = args.includes("--yes");
  if (!briefingPath) {
    console.error("Usage: pnpm golden <briefing.json> [--all] [--yes]");
    process.exit(1);
  }

  const briefing = loadBriefing(path.resolve(briefingPath));
  const adId = `ad_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}_${briefing.id}`;
  const dir = ensureDir(adDir(adId));
  console.log(`\n=== ${adId} ===\nAngle: ${briefing.angle}\n`);

  // 1. Scripts with approval loop (GATE 1)
  let scripts: ScriptSet | undefined;
  let feedback: string | undefined;
  const winningPatterns = loadWinningPatterns();
  if (winningPatterns) console.log("Winning patterns from the performance loop are included in the script prompt.");
  while (true) {
    console.log(feedback ? "Überarbeite Skripte..." : "Generiere Skripte...");
    scripts = await generateScripts(briefing, feedback, winningPatterns);
    console.log("\n" + describeScripts(scripts) + "\n");
    if (autoApprove) break;
    const approval = await askApproval();
    if (approval.action === "approve") break;
    if (approval.action === "abort") process.exit(0);
    feedback = approval.feedback;
  }
  fs.writeFileSync(path.join(dir, "scripts.json"), JSON.stringify(scripts, null, 2));

  // 2. Build segments (first hook/cta unless --all)
  const hooks = all ? scripts.hooks : scripts.hooks.slice(0, 1);
  const ctas = all ? scripts.ctas : scripts.ctas.slice(0, 1);
  const segments = {
    hooks: hooks.map((h, i) => makeSegment(`h${i + 1}`, "hook", h.scriptDe)),
    body: makeSegment("b1", "body", scripts.body.scriptDe),
    ctas: ctas.map((c, i) => makeSegment(`c${i + 1}`, "cta", c.scriptDe)),
  };

  // 3. Audio + avatar per segment (audio first, avatar driven by it)
  for (const seg of [...segments.hooks, segments.body, ...segments.ctas]) {
    console.log(`\n[${seg.id}] ElevenLabs TTS...`);
    const audioPath = path.join(dir, `${seg.id}.mp3`);
    const tts = await synthesize(seg.scriptDe, audioPath);
    seg.audioPath = audioPath;
    seg.durationMs = tts.durationMs;
    seg.words = tts.words;
    console.log(
      `[${seg.id}] ${(tts.durationMs / 1000).toFixed(1)}s (timestamps: ${tts.timestampSource})`,
    );

    console.log(`[${seg.id}] HeyGen avatar...`);
    const avatarPath = path.join(dir, `${seg.id}.mp4`);
    await generateAvatarClip(audioPath, avatarPath, {
      onStatus: (s) => process.stdout.write(`\r[${seg.id}] HeyGen: ${s}        `),
    });
    console.log();
    seg.avatarPath = avatarPath;

    seg.beats = planBeats(seg);
  }

  const project: AdProject = {
    id: adId,
    briefing,
    segments,
    state: "assembly",
    createdAt: new Date().toISOString(),
  };
  saveProject(project);

  // 4. Render every hook x cta variant
  for (const hook of segments.hooks) {
    for (const cta of segments.ctas) {
      const renderPath = await renderVariant(project, hook, segments.body, cta);
      publishToVideoFolder(`${project.id}_${hook.id}_${cta.id}`, renderPath);
    }
  }

  console.log(`\nDone. Output in ${path.join(dir, "out")} and ${VIDEO_DIR}`);
}

function makeSegment(id: string, role: Segment["role"], scriptDe: string): Segment {
  return { id, role, scriptDe, estimatedMs: estimateDurationMs(scriptDe), beats: [] };
}

// Phase-0 beat plan, modeled on the reference ad (data/reference/
// example-teardown.md): hook = talking head only; body = open on the face,
// then continuous b-roll cut every ~2.5s; CTA = rapid b-roll cuts (~1.2s).
// B-roll is picked round-robin from data/broll — the indexed library with
// anti-repetition replaces this in Phase 1.
let brollCursor = 0;
function planBeats(seg: Segment): Beat[] {
  const clips = listBrollClips();
  const dur = seg.durationMs ?? seg.estimatedMs ?? 4000;
  if (seg.role === "hook" || clips.length === 0) {
    return [{ startMs: 0, endMs: dur, kind: "talking_head" }];
  }
  const window = seg.role === "cta" ? 1200 : 2500;
  const beats: Beat[] = [];
  let t = seg.role === "body" ? Math.min(1500, dur) : 0; // body: face first
  if (t > 0) beats.push({ startMs: 0, endMs: t, kind: "talking_head" });
  while (t < dur) {
    const end = Math.min(t + window, dur);
    const clip = clips[brollCursor++ % clips.length];
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

async function renderVariant(
  project: AdProject,
  hook: Segment,
  body: Segment,
  cta: Segment,
): Promise<string> {
  const variantId = `${project.id}_${hook.id}_${cta.id}`;
  console.log(`\nRendering ${variantId}...`);

  // Remotion can only load assets from its public dir — stage them there.
  const publicDir = ensureDir(path.join(REMOTION_PUBLIC_ADS, project.id));
  const ordered = [hook, body, cta];
  const props = {
    segments: ordered.map((seg) => ({
      id: seg.id,
      durationMs: seg.durationMs ?? seg.estimatedMs ?? 4000,
      avatarSrc: stage(seg.avatarPath!, publicDir, project.id),
      words: seg.words ?? [],
      beats: seg.beats.map((b) => ({
        ...b,
        clipPath: b.clipPath ? stage(b.clipPath, publicDir, project.id) : undefined,
      })),
    })),
  };

  const outDir = ensureDir(path.join(adDir(project.id), "out"));
  const propsFile = path.join(outDir, `${variantId}.props.json`);
  fs.writeFileSync(propsFile, JSON.stringify(props, null, 2));

  // shell:true on Windows — Node 20+ refuses to spawn .cmd shims directly
  await run(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "remotion", "render", "src/index.ts", "AdComposition",
      path.join(outDir, `${variantId}.mp4`),
      `--props=${propsFile}`,
    ],
    {
      cwd: REMOTION_DIR,
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32",
    },
  );
  console.log(`Rendered ${variantId}.mp4`);
  return path.join(outDir, `${variantId}.mp4`);
}

// Copies an asset into the remotion public dir, returns the staticFile path.
function stage(absPath: string, publicDir: string, adId: string): string {
  const dest = path.join(publicDir, path.basename(absPath));
  if (!fs.existsSync(dest)) fs.copyFileSync(absPath, dest);
  return `ads/${adId}/${path.basename(absPath)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
