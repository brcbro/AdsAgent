import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const run = promisify(execFile);
const API = "https://api.heygen.com/v3";
export type HeyGenAvatar = {
  avatar_id: string; avatar_name: string; preview_image_url?: string; preview_video_url?: string;
  gender?: string; premium?: boolean; ownership?: "public" | "private";
  avatar_type?: string; supported_api_engines?: string[]; status?: string;
  /** HeyGen's own voice for this avatar; every look in the same group shares it. */
  default_voice_id?: string;
  /** Looks of the same person (different outfits, settings) share a group. */
  group_id?: string;
};
export type HeyGenVoice = {
  voice_id: string; name: string; language?: string; gender?: string;
  preview_audio_url?: string | null; type: "public" | "private";
};
type Look = { id: string; name: string; preview_image_url?: string; preview_video_url?: string;
  gender?: string; avatar_type?: string; supported_api_engines?: string[]; status?: string; ownership?: "public" | "private";
  default_voice_id?: string; group_id?: string };
type Envelope<T> = { data: T; error?: { message?: string; code?: string }; has_more?: boolean; next_token?: string };

async function apiRequest<T>(route: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  headers.set("X-Api-Key", config.heygenApiKey());
  const response = await fetch(`${API}${route}`, { ...init, headers, signal: AbortSignal.timeout(90_000) });
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.error) {
    const message = (body.error?.message || response.statusText).replaceAll(config.heygenApiKey(), "[redacted]");
    throw new Error(`HeyGen ${response.status}: ${message}`);
  }
  if (body.data == null) throw new Error(`HeyGen returned no data for ${route}`);
  return body;
}
/** Own photo avatars report "Man"/"Woman"; the catalog uses "male"/"female". */
export function normalizeGender(gender?: string): string | undefined {
  const g = gender?.trim().toLowerCase();
  if (!g) return undefined;
  if (["woman", "female", "f"].includes(g)) return "female";
  if (["man", "male", "m"].includes(g)) return "male";
  return g === "unknown" ? undefined : g;
}
function toAvatar(look: Look, ownership?: "public" | "private"): HeyGenAvatar {
  if (!look.id || !look.name) throw new Error("HeyGen returned an invalid avatar look");
  return { avatar_id: look.id, avatar_name: look.name, preview_image_url: look.preview_image_url,
    preview_video_url: look.preview_video_url, gender: normalizeGender(look.gender), avatar_type: look.avatar_type,
    supported_api_engines: look.supported_api_engines, status: look.status, ownership: ownership ?? look.ownership,
    ...(look.default_voice_id ? { default_voice_id: look.default_voice_id } : {}),
    ...(look.group_id ? { group_id: look.group_id } : {}) };
}
/** One voice by ID (name, language, gender), e.g. to show an avatar's own voice. */
export async function getVoice(id: string): Promise<HeyGenVoice> {
  const { data } = await apiRequest<HeyGenVoice & { type?: "public" | "private" }>(`/voices/${encodeURIComponent(id)}`);
  if (!data.voice_id && !data.name) throw new Error("HeyGen returned an invalid voice");
  return { voice_id: data.voice_id || id, name: data.name, language: data.language, gender: normalizeGender(data.gender),
    preview_audio_url: data.preview_audio_url ?? null, type: data.type ?? "public" };
}
/** HeyGen generates the speech; ElevenLabs (by default V4) is the voice engine it uses. */
export function elevenLabsVoiceSettings(model: string) {
  return { engine_settings: { engine_type: "elevenlabs", model } };
}
export function isPortraitSourceAvatar(avatar: HeyGenAvatar): boolean {
  return `${avatar.preview_image_url ?? ""}${avatar.preview_video_url ?? ""}`.includes("preview_talk");
}
export function isPublicHeyGenAvatar(avatar: HeyGenAvatar): boolean {
  return avatar.ownership ? avatar.ownership === "public" : !/^[a-f0-9]{32}$/i.test(avatar.avatar_id);
}
export function dedupeAvatars(avatars: HeyGenAvatar[]): HeyGenAvatar[] {
  const seen = new Set<string>();
  return avatars.filter(a => !seen.has(a.avatar_id) && !!seen.add(a.avatar_id));
}
export function voiceIdForGender(gender?: string): string {
  return gender?.toLowerCase() === "female" ? "148b505539a04ed98a3c2188515183cc" : "0164301557ba403580f4805f392c1a2a";
}
export async function getAvatarLook(id: string): Promise<HeyGenAvatar> {
  if (!id.trim()) throw new Error("Choose a HeyGen avatar first");
  return toAvatar((await apiRequest<Look>(`/avatars/looks/${encodeURIComponent(id)}`)).data);
}
export async function listAvatars(ownership: "public" | "private" = "public", onPage?: (count: number) => void): Promise<HeyGenAvatar[]> {
  const avatars: HeyGenAvatar[] = []; const tokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 150; page++) {
    // Public: the stock studio library (photo-look discovery is a separate catalog).
    // Private: every look the account owns — studio, digital twin and photo avatars.
    const query = new URLSearchParams({ ownership, limit: "50" });
    if (ownership === "public") query.set("avatar_type", "studio_avatar");
    if (token) query.set("token", token);
    const body = await apiRequest<Look[]>(`/avatars/looks?${query}`);
    if (!Array.isArray(body.data)) throw new Error("Invalid HeyGen avatar catalog response");
    avatars.push(...body.data.map(a => toAvatar(a, ownership)));
    onPage?.(avatars.length);
    if (!body.has_more) return dedupeAvatars(avatars);
    if (!body.next_token || tokens.has(body.next_token)) throw new Error("HeyGen avatar pagination did not advance; catalog was not replaced");
    token = body.next_token; tokens.add(token);
  }
  throw new Error("HeyGen avatar catalog exceeded the page limit; catalog was not replaced");
}
export const listPrivateAvatars = (onPage?: (count: number) => void) => listAvatars("private", onPage);
/** Voices in the HeyGen account: "private" are the user's own (clones, recordings), "public" the HeyGen library. */
export async function listVoices(type: "public" | "private", language?: string): Promise<HeyGenVoice[]> {
  const voices: HeyGenVoice[] = []; const tokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 60; page++) {
    // Only voices HeyGen can speak through ElevenLabs, since every avatar video uses that engine.
    const query = new URLSearchParams({ type, limit: "100", engine: "elevenlabs" });
    if (language) query.set("language", language);
    if (token) query.set("token", token);
    const body = await apiRequest<HeyGenVoice[]>(`/voices?${query}`);
    if (!Array.isArray(body.data)) throw new Error("Invalid HeyGen voice list response");
    for (const v of body.data) {
      if (!v.voice_id || !v.name) continue;
      voices.push({ voice_id: v.voice_id, name: v.name, language: v.language, gender: normalizeGender(v.gender),
        preview_audio_url: v.preview_audio_url ?? null, type });
    }
    if (!body.has_more || !body.next_token || tokens.has(body.next_token)) break;
    token = body.next_token; tokens.add(token);
  }
  const seen = new Set<string>();
  return voices.filter(v => !seen.has(v.voice_id) && !!seen.add(v.voice_id));
}
export const listPublicAvatars = (onPage?: (count: number) => void) => listAvatars("public", onPage);
export async function listPortraitAvatars(): Promise<HeyGenAvatar[]> { return (await listPublicAvatars()).filter(isPortraitSourceAvatar); }
export async function getHeyGenBalance(): Promise<{ billingType?: string; remainingBalance?: number; currency?: string }> {
  const { data } = await apiRequest<{ billing_type?: string; wallet?: { remaining_balance: number; currency: string } }>("/users/me");
  return { billingType: data.billing_type, remainingBalance: data.wallet?.remaining_balance, currency: data.wallet?.currency };
}

type AvatarRequest = { fingerprint: string; key: string; createdAt: string; assetId?: string; videoId?: string;
  submittedAt?: string; status?: string; body?: Record<string, unknown> };
export async function generateAvatarClip(scriptOrAudioPath: string, outPath: string, opts?: {
  avatarId?: string; gender?: string; voiceId?: string; portrait?: boolean;
  /** ElevenLabs model HeyGen speaks the script with (script mode only). Defaults to HEYGEN_VOICE_MODEL / eleven_v4. */
  voiceModel?: string;
  onStatus?: (status: string) => void;
}): Promise<{ durationMs: number; subtitlesPath?: string }> {
  const avatarId = opts?.avatarId ?? config.heygenAvatarId();
  const portrait = opts?.portrait !== false;
  const isAudio = /\.(mp3|wav)$/i.test(scriptOrAudioPath);
  const voiceModel = isAudio ? undefined : opts?.voiceModel ?? config.heygenVoiceModel();
  const source = isAudio ? fs.readFileSync(scriptOrAudioPath) : Buffer.from(scriptOrAudioPath);
  const fingerprint = createHash("sha256").update(source).update(JSON.stringify({ avatarId, portrait, voiceId: opts?.voiceId, gender: opts?.gender, voiceModel })).digest("hex");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const checkpointPath = `${outPath}.heygen.json`;
  let saved: AvatarRequest | undefined;
  if (fs.existsSync(checkpointPath)) saved = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  const request: AvatarRequest = saved?.fingerprint === fingerprint ? saved : { fingerprint, key: randomUUID(), createdAt: new Date().toISOString() };
  const save = () => { fs.writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(request, null, 2)); fs.renameSync(`${checkpointPath}.tmp`, checkpointPath); };
  if (!request.videoId) {
    if (request.submittedAt && Date.now() - Date.parse(request.submittedAt) > 23 * 60 * 60_000) {
      throw new Error("HeyGen submission is older than the safe retry window. Check your HeyGen video history before starting another generation.");
    }
    if (!request.body) {
      const avatar = await getAvatarLook(avatarId);
      if (avatar.status && !["completed", "ready"].includes(avatar.status)) throw new Error(`HeyGen avatar is ${avatar.status}; choose a ready avatar`);
      const balance = await getHeyGenBalance();
      if (balance.billingType === "wallet" && balance.remainingBalance !== undefined && balance.remainingBalance <= 0) throw new Error("HeyGen API wallet is empty");
      const engines = avatar.supported_api_engines;
      const engine = !engines?.length || engines.includes("avatar_iv") ? "avatar_iv" : engines.includes("avatar_iii") ? "avatar_iii" : engines.includes("avatar_v") ? "avatar_v" : undefined;
      if (!engine) throw new Error("This avatar does not support API video generation");
      save();
      if (isAudio && !request.assetId) {
        const form = new FormData();
        form.append("file", new Blob([source], { type: /\.wav$/i.test(scriptOrAudioPath) ? "audio/wav" : "audio/mpeg" }), path.basename(scriptOrAudioPath));
        const upload = await apiRequest<{ asset_id: string }>("/assets", { method: "POST", body: form, headers: { "Idempotency-Key": `${request.key}:audio` } });
        if (!upload.data.asset_id) throw new Error("HeyGen upload returned no asset ID");
        request.assetId = upload.data.asset_id; save();
      }
      request.body = { type: "avatar", avatar_id: avatarId, aspect_ratio: portrait ? "9:16" : "16:9",
        resolution: "1080p", fit: "cover", output_format: "mp4", engine: { type: engine },
        ...(isAudio ? { audio_asset_id: request.assetId } : {
          script: scriptOrAudioPath,
          // The avatar's own voice unless another was chosen; all looks of one avatar share it.
          voice_id: opts?.voiceId ?? avatar.default_voice_id ?? voiceIdForGender(opts?.gender),
          // HeyGen generates the audio, using ElevenLabs (V4 by default) as its voice engine.
          voice_settings: elevenLabsVoiceSettings(voiceModel!),
        }) };
      // HeyGen always returns an SRT sidecar (subtitle_url); it gives caption timings for its own voice.
      save();
    }
    request.submittedAt ??= new Date().toISOString(); save();
    const generated = await apiRequest<{ video_id: string }>("/videos", { method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
    if (!generated.data.video_id) throw new Error("HeyGen returned no video ID; the saved request key must be reused");
    request.videoId = generated.data.video_id; save();
  }
  const done = await pollVideo(request.videoId!, status => { request.status = status; save(); opts?.onStatus?.(status); });
  let subtitlesPath: string | undefined;
  if (!isAudio && done.subtitleUrl) {
    // Captions are a convenience: a failed download falls back to estimated timings, never fails the paid video.
    try {
      const srt = await fetch(done.subtitleUrl, { signal: AbortSignal.timeout(60_000) });
      if (srt.ok) { subtitlesPath = `${outPath}.srt`; fs.writeFileSync(subtitlesPath, await srt.text()); }
    } catch { subtitlesPath = undefined; }
  }
  const video = await fetch(done.videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!video.ok) throw new Error(`HeyGen video download failed: ${video.status}`);
  fs.writeFileSync(`${outPath}.download`, Buffer.from(await video.arrayBuffer()));
  const durationMs = await probeDurationMs(`${outPath}.download`);
  fs.renameSync(`${outPath}.download`, outPath);
  return { durationMs, subtitlesPath };
}
async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  const duration = Math.round(Number(stdout.trim()) * 1000);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("HeyGen returned an unreadable video");
  return duration;
}
export async function pollUntilDone(videoId: string, onStatus?: (status: string) => void, timeoutMs = 45 * 60_000): Promise<string> {
  return (await pollVideo(videoId, onStatus, timeoutMs)).videoUrl;
}
async function pollVideo(videoId: string, onStatus?: (status: string) => void, timeoutMs = 45 * 60_000): Promise<{ videoUrl: string; subtitleUrl?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await apiRequest<{ status: string; video_url?: string; subtitle_url?: string; failure_message?: string;
      error?: { message?: string } | string }>(`/videos/${encodeURIComponent(videoId)}`);
    onStatus?.(data.status);
    if (data.status === "completed") {
      if (!data.video_url) throw new Error("HeyGen completed the video without a download URL");
      return { videoUrl: data.video_url, subtitleUrl: data.subtitle_url };
    }
    if (["failed", "canceled", "cancelled"].includes(data.status)) throw new Error(`HeyGen render ${data.status}: ${typeof data.error === "string" ? data.error : data.error?.message ?? data.failure_message ?? "Check HeyGen video history"}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("HeyGen render timed out. The video ID is saved; retry resumes polling without purchasing another video.");
}
