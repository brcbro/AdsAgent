import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adDir, ensureDir } from "@ai-ads/core";
import { config } from "./config.js";
import { synthesize, type TtsResult } from "./elevenlabs.js";
import { loadMetadata, runProduce, saveMetadata } from "./produce.js";
import { prepareVoicePreviewSource } from "./voice-preview-source.js";

export function voiceMatchesRequest(saved: { scriptDe?: string; modelId?: string; voiceId?: string; languageCode?: string },
  request: { scriptDe: string; modelId: string; voiceId: string; languageCode: string }): boolean {
  return saved.scriptDe === request.scriptDe && saved.modelId === request.modelId &&
    saved.voiceId === request.voiceId && saved.languageCode === request.languageCode;
}

export async function ensureNarration(id: string, sourceId?: string): Promise<TtsResult> {
  const meta = loadMetadata(id);
  if (!meta) throw new Error(`Missing project ${id}`);
  const dir = ensureDir(adDir(id));
  const audioPath = path.join(dir, "main.mp3");
  const request = { scriptDe: meta.scriptDe, modelId: config.elevenLabsModel(),
    voiceId: config.elevenLabsVoiceId(), languageCode: config.elevenLabsLanguage() };
  let reused = false;
  let savedTts: TtsResult | undefined;
  // Never reuse narration after the text, voice, model, or language changes.
  for (const cacheId of [id, sourceId].filter(Boolean) as string[]) {
    const sourceAudio = path.join(adDir(cacheId), "main.mp3");
    const sourceTimings = path.join(adDir(cacheId), "main.tts.json");
    if (fs.existsSync(sourceAudio) && fs.existsSync(sourceTimings)) {
      try {
        if (voiceMatchesRequest(JSON.parse(fs.readFileSync(sourceTimings, "utf8")), request)) {
          if (cacheId !== id) {
            fs.copyFileSync(sourceAudio, audioPath);
            fs.copyFileSync(sourceTimings, path.join(dir, "main.tts.json"));
          }
          reused = true;
          savedTts = JSON.parse(fs.readFileSync(sourceTimings, "utf8"));
          break;
        }
      } catch { /* An unreadable cache should generate fresh narration. */ }
    }
  }
  meta.status = "generating";
  saveMetadata(meta);
  console.log(`[${id}] ${reused ? "Reusing matching German narration" : "Generating ElevenLabs German narration"}`);
  if (!reused) {
    const marker = path.join(dir, "voice-attempt.json");
    if (fs.existsSync(marker)) throw new Error("Interrupted voice request: no complete audio checkpoint. Review and explicitly retry; another request may use ElevenLabs credits.");
    fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), ...request }));
    savedTts = await synthesize(meta.scriptDe, audioPath);
    fs.unlinkSync(marker);
  }
  return savedTts!;
}

export async function runLocalPreview(id: string, sourceId?: string, onStage?: (stage: "voice" | "render") => void): Promise<void> {
  const meta = loadMetadata(id);
  if (!meta) throw new Error(`Missing project ${id}`);
  if (meta.avatar.heygenAvatarId) throw new Error("Local preview must not contain a HeyGen avatar");
  onStage?.("voice");
  await ensureNarration(id, sourceId);
  const audioPath = path.join(adDir(id), "main.mp3");
  await prepareVoicePreviewSource(meta, audioPath);
  // The local source exists before produce runs; missing sources fail closed.
  onStage?.("render");
  await runProduce(meta, { skipHeygen: true, elevenLabs: true, renderer: "ffmpeg", semanticBroll: true, factory: false, shuffleBroll: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  runLocalPreview(id, process.argv[3]).catch(err => {
    const meta = id ? loadMetadata(id) : null;
    if (meta) {
      meta.status = "error";
      meta.error = err instanceof Error ? err.message : String(err);
      meta.updatedAt = new Date().toISOString();
      saveMetadata(meta);
    }
    console.error(err);
    process.exitCode = 1;
  });
}
