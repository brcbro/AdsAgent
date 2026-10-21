import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Segment,
  WordTimestamp,
  ProjectMetadata,
  REPO_ROOT,
  ADS_DIR,
  agentClipPath,
  adDir,
  ensureDir,
  estimateDurationMs,
  SESSION_VIDEO_DIR,
  VIDEO_SESSION,
  projectMetadataPath,
} from "@ai-ads/core";
import { generateAvatarClip } from "./heygen.js";
import { publishToVideoFolder } from "./publish.js";
import { saveRenderVersion } from "./versions.js";
import { synthesize } from "./elevenlabs.js";
import { getAvatarLook } from "./heygen.js";
import { config } from "./config.js";
import { proportionalWords } from "./timing.js";
import { assertScriptCompliant } from "./compliance.js";
import { planBeatsForAd } from "./beat-plan.js";
import { renderAd, applyOutputSpeed } from "./render-ad.js";

export type ProduceOptions = {
  /** Reuse a saved avatar clip instead of calling HeyGen. */
  skipHeygen: boolean;
  /** ElevenLabs voice + HeyGen lip-sync (default). False = HeyGen generates the voice. */
  elevenLabs: boolean;
  renderer: "remotion" | "ffmpeg";
  /** Factory mode: uppercase captions and semantic B-roll. */
  factory: boolean;
  semanticBroll: boolean;
  shuffleBroll: boolean;
};

/** Maps the legacy CLI flags onto options. Used when no options are passed. */
export function produceOptionsFromArgv(argv: string[] = process.argv): ProduceOptions {
  const has = (flag: string) => argv.includes(flag);
  const factory = has("--factory");
  return {
    skipHeygen: has("--skip-heygen"),
    elevenLabs: !has("--heygen-voice"),
    renderer: has("--renderer=ffmpeg") ? "ffmpeg" : "remotion",
    factory,
    semanticBroll: has("--semantic-broll") || factory,
    shuffleBroll: has("--shuffle-broll"),
  };
}

function inferGender(name?: string): "male" | "female" {
  const n = (name ?? "").toLowerCase();
  if (/annie|anna|sara|julia|female|frau|woman|girl/.test(n)) return "female";
  if (/bojan|brandon|artur|josh|male|mann|man|denis|dennis|adrian/.test(n)) return "male";
  return "female";
}

const run = promisify(execFile);

async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return Math.round(parseFloat(stdout.trim()) * 1000);
}

export async function runProduce(
  meta: ProjectMetadata,
  options: ProduceOptions = produceOptionsFromArgv(),
): Promise<ProjectMetadata> {
  // Claims are checked before anything is generated or paid for.
  assertScriptCompliant(meta.scriptDe);

  const dir = ensureDir(adDir(meta.id));
  const { skipHeygen } = options;

  meta.status = "generating";
  meta.updatedAt = new Date().toISOString();
  saveMetadata(meta);

  const seg: Segment = {
    id: "main",
    role: "body",
    scriptDe: meta.scriptDe,
    estimatedMs: estimateDurationMs(meta.scriptDe),
    beats: [],
  };

  const adAvatarPath = path.join(dir, "main.mp4");
  const agentAvatarPath = agentClipPath(meta.id);
  const savedClip = skipHeygen
    ? [agentAvatarPath, adAvatarPath].find((p) => fs.existsSync(p))
    : undefined;
  if (skipHeygen && !savedClip) {
    throw new Error("No saved source clip. Create a local preview or avatar video first.");
  }
  let avatarPath = agentAvatarPath;

  if (skipHeygen) {
    avatarPath = savedClip!;
    const source = avatarPath === agentAvatarPath ? "agent" : "ads";
    console.log(`[${meta.id}] Reusing saved source clip (${source})`);
    seg.durationMs = await probeDurationMs(avatarPath);
    const propsPath = path.join(dir, "out", "render.props.json");
    let savedWords: WordTimestamp[] | undefined;
    if (fs.existsSync(propsPath)) {
      try {
        savedWords = JSON.parse(fs.readFileSync(propsPath, "utf-8")).segments?.[0]?.words;
      } catch {
        savedWords = undefined;
      }
    }
    seg.words = savedWords ?? proportionalWords(meta.scriptDe, seg.durationMs);
    const ttsPath = path.join(dir, "main.tts.json");
    if (fs.existsSync(ttsPath)) {
      const tts = JSON.parse(fs.readFileSync(ttsPath, "utf8"));
      if (tts.scriptDe === meta.scriptDe && Array.isArray(tts.words) && tts.words.length) seg.words = tts.words;
    }
  } else {
    // Catch stale avatar selections before buying narration.
    await getAvatarLook(meta.avatar.heygenAvatarId || config.heygenAvatarId());
    const gender = meta.avatar.gender ?? inferGender(meta.avatar.name);
    const portrait = meta.aspectRatio === "9:16";
    const heygenT0 = Date.now();
    ensureDir(path.dirname(agentAvatarPath));

    if (options.elevenLabs) {
      const audioPath = path.join(dir, "main.mp3");
      console.log(`[${meta.id}] ElevenLabs ${config.elevenLabsModel()} TTS...`);
      const tts = await synthesize(meta.scriptDe, audioPath);
      seg.words = tts.words;
      seg.audioPath = audioPath;
      console.log(
        `[${meta.id}] HeyGen lip-sync (${tts.timestampSource} timestamps, ${(tts.durationMs / 1000).toFixed(1)}s audio)...`,
      );
      const { durationMs } = await generateAvatarClip(audioPath, agentAvatarPath, {
        avatarId: meta.avatar.heygenAvatarId,
        portrait,
        onStatus: (s) => process.stdout.write(`\r[${meta.id}] HeyGen: ${s}        `),
      });
      console.log();
      seg.durationMs = durationMs;
      console.log(
        `[${meta.id}] Avatar ${(durationMs / 1000).toFixed(1)}s (HeyGen ${((Date.now() - heygenT0) / 1000 / 60).toFixed(1)} min)`,
      );
    } else {
      console.log(`[${meta.id}] HeyGen ${gender} avatar ${meta.avatar.heygenAvatarId} (${portrait ? "9:16" : "16:9"})...`);
      const { durationMs } = await generateAvatarClip(meta.scriptDe, agentAvatarPath, {
        avatarId: meta.avatar.heygenAvatarId,
        gender,
        portrait,
        onStatus: (s) => process.stdout.write(`\r[${meta.id}] HeyGen: ${s}        `),
      });
      console.log();
      seg.durationMs = durationMs;
      seg.words = proportionalWords(meta.scriptDe, durationMs);
      console.log(
        `[${meta.id}] Avatar ${(durationMs / 1000).toFixed(1)}s (HeyGen ${((Date.now() - heygenT0) / 1000 / 60).toFixed(1)} min)`,
      );
    }
    fs.copyFileSync(agentAvatarPath, adAvatarPath);
  }
  seg.avatarPath = avatarPath;

  const beatsPath = path.join(dir, "beats.json");
  if (skipHeygen && fs.existsSync(beatsPath) && !options.shuffleBroll && !options.semanticBroll) {
    seg.beats = JSON.parse(fs.readFileSync(beatsPath, "utf-8")).beats;
  } else {
    seg.beats = planBeatsForAd(seg, meta.introMs, meta.id, {
      fullAvatar: meta.fullAvatar,
      brollCutMs: meta.brollCutMs,
      fastCuts: meta.fastCuts,
      semantic: options.semanticBroll,
      pinned: meta.brollPinned,
      excluded: meta.brollExcluded,
    });
  }

  meta.status = "rendering";
  saveMetadata(meta);

  const renderer = options.renderer;
  const renderT0 = Date.now();
  let renderPath = await renderAd(meta, seg, renderer, {
    skipHeygen,
    factory: options.factory,
    save: saveMetadata,
  });
  const renderSec = (Date.now() - renderT0) / 1000;
  console.log(
    `[${meta.id}] ${renderer} done (${renderSec >= 60 ? `${(renderSec / 60).toFixed(1)} min` : `${renderSec.toFixed(1)}s`})`,
  );

  const speed = meta.outputSpeed ?? 1;
  if (speed > 1.001 || speed < 0.999) {
    renderPath = await applyOutputSpeed(renderPath, speed);
    console.log(`[${meta.id}] Final export ${speed}× speed (avatar + music + B-roll)`);
  }
  meta.outputFile = renderPath;
  meta.status = "done";
  meta.updatedAt = new Date().toISOString();
  saveMetadata(meta);

  const out = publishToVideoFolder(meta.id, renderPath);
  // History is a convenience: a failed copy must not fail an otherwise finished render.
  try {
    saveRenderVersion(meta, renderPath);
  } catch (err) {
    console.warn(`[${meta.id}] Could not save render version: ${(err as Error).message}`);
  }
  console.log(`[${meta.id}] Done → ${path.relative(REPO_ROOT, out)}`);
  return meta;
}

export function metadataPath(id: string): string {
  return projectMetadataPath(id);
}

export function loadMetadata(id: string): ProjectMetadata | null {
  const p = metadataPath(id);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  return null;
}

export function saveMetadata(meta: ProjectMetadata): void {
  ensureDir(adDir(meta.id));
  fs.writeFileSync(metadataPath(meta.id), JSON.stringify(meta, null, 2));
}

export function listProjects(): string[] {
  const ids = new Set<string>();
  const skip = new Set(["_debug", "previews", VIDEO_SESSION]);

  if (fs.existsSync(ADS_DIR)) {
    for (const d of fs.readdirSync(ADS_DIR)) {
      if (skip.has(d)) continue;
      if (fs.existsSync(projectMetadataPath(d))) ids.add(d);
    }
  }
  if (fs.existsSync(SESSION_VIDEO_DIR)) {
    for (const f of fs.readdirSync(SESSION_VIDEO_DIR)) {
      if (!f.endsWith(".mp4")) continue;
      const id = f.replace(/\.mp4$/, "");
      if (!skip.has(id) && !id.includes("/")) ids.add(id);
    }
  }
  return [...ids].sort();
}
