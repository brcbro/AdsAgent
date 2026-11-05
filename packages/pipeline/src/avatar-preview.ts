import fs from "node:fs";
import path from "node:path";
import { adDir, agentClipPath } from "@ai-ads/core";
import { generateAvatarClip, getAvatarLook } from "./heygen.js";
import { loadMetadata, runProduce, saveHeygenWords, saveMetadata, useAvatarVoice } from "./produce.js";
import { config } from "./config.js";
import { assertScriptCompliant } from "./compliance.js";

/**
 * Agent production: HeyGen generates the presenter and the audio (its ElevenLabs V4 engine, the avatar's own voice),
 * then B-roll, captions and music are rendered on top. No direct ElevenLabs API call is made.
 */
export async function runAvatarPreview(id: string, onStage: (stage: "voice" | "avatar" | "render", detail?: string) => void): Promise<void> {
  const meta = loadMetadata(id);
  if (!meta?.avatar.heygenAvatarId) throw new Error("Select a HeyGen presenter before production");
  assertScriptCompliant(meta.scriptDe);
  // Validate the live look before spending HeyGen credits.
  const look = await getAvatarLook(meta.avatar.heygenAvatarId);
  meta.avatar.name = look.avatar_name;
  meta.avatar.previewImageUrl = look.preview_image_url;
  saveMetadata(meta);
  await useAvatarVoice(meta, look);
  const source = agentClipPath(id);
  const wordsFile = path.join(adDir(id), "heygen-words.json");
  const savedWords = fs.existsSync(wordsFile) ? JSON.parse(fs.readFileSync(wordsFile, "utf8")) : undefined;
  // A completed clip for this exact script, voice and voice model is reused. Interrupted HeyGen requests resume from their own checkpoint.
  const reusable = fs.existsSync(source) && savedWords?.scriptDe === meta.scriptDe && savedWords?.voiceId === meta.avatar.voiceId
    && savedWords?.voiceModel === config.heygenVoiceModel();
  if (!reusable) {
    if (fs.existsSync(source)) fs.unlinkSync(source);
    onStage("avatar", `Submitting or resuming HeyGen v3 presenter${meta.avatar.voiceName ? ` with voice "${meta.avatar.voiceName}"` : ""} (ElevenLabs ${config.heygenVoiceModel()})`);
    let previous = "";
    const { durationMs, subtitlesPath } = await generateAvatarClip(meta.scriptDe, source, {
      avatarId: meta.avatar.heygenAvatarId, voiceId: meta.avatar.voiceId, gender: meta.avatar.gender,
      voiceModel: config.heygenVoiceModel(),
      portrait: meta.aspectRatio === "9:16",
      onStatus: status => { if (status !== previous) { previous = status; onStage("avatar", `HeyGen: ${status}`); } },
    });
    saveHeygenWords(meta, durationMs, subtitlesPath);
  }
  fs.copyFileSync(source, path.join(adDir(id), "main.mp4"));
  onStage("render");
  await runProduce(meta, { skipHeygen: true, elevenLabs: false, renderer: "ffmpeg", semanticBroll: true, factory: false, shuffleBroll: false });
}
