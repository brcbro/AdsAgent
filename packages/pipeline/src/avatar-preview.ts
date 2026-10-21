import fs from "node:fs";
import path from "node:path";
import { adDir, agentClipPath } from "@ai-ads/core";
import { ensureNarration } from "./local-preview.js";
import { generateAvatarClip, getAvatarLook } from "./heygen.js";
import { loadMetadata, runProduce, saveMetadata } from "./produce.js";

export async function runAvatarPreview(id: string, onStage: (stage: "voice" | "avatar" | "render", detail?: string) => void): Promise<void> {
  const meta = loadMetadata(id);
  if (!meta?.avatar.heygenAvatarId) throw new Error("Select a HeyGen presenter before production");
  // Validate the live look before spending ElevenLabs credits.
  const look = await getAvatarLook(meta.avatar.heygenAvatarId);
  meta.avatar.name = look.avatar_name;
  meta.avatar.previewImageUrl = look.preview_image_url;
  saveMetadata(meta);
  onStage("voice");
  await ensureNarration(id);
  const source = agentClipPath(id);
  // A saved completed source is reused. Interrupted HeyGen requests resume from their own checkpoint.
  if (!fs.existsSync(source)) {
    onStage("avatar", "Submitting or resuming HeyGen v3 lip-sync");
    let previous = "";
    await generateAvatarClip(path.join(adDir(id), "main.mp3"), source, {
      avatarId: meta.avatar.heygenAvatarId, portrait: meta.aspectRatio === "9:16",
      onStatus: status => { if (status !== previous) { previous = status; onStage("avatar", `HeyGen: ${status}`); } },
    });
  }
  fs.copyFileSync(source, path.join(adDir(id), "main.mp4"));
  onStage("render");
  await runProduce(meta, { skipHeygen: true, elevenLabs: true, renderer: "ffmpeg", semanticBroll: true, factory: false, shuffleBroll: false });
}
