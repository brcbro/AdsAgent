import fs from "node:fs";
import type express from "express";
import { getAvatarLook, getVoice, listVoices, type HeyGenAvatar, type HeyGenVoice } from "../../../pipeline/src/heygen.js";
import { config } from "../../../pipeline/src/config.js";
import {
  PRIVATE_AVATAR_CATALOG, cachedPrivateAvatars, cachedPublicAvatars, refreshAvatarCatalog, refreshPrivateAvatarCatalog,
} from "../../../pipeline/src/avatar-catalog.js";

const VOICE_TTL_MS = 15 * 60_000;
const voiceCache = new Map<string, { at: number; voices: HeyGenVoice[] }>();
let privateRefresh: Promise<HeyGenAvatar[]> | undefined;

function expiredImage(avatar: HeyGenAvatar): boolean {
  try {
    const expires = new URL(avatar.preview_image_url ?? "").searchParams.get("Expires");
    return expires !== null && Number(expires) * 1000 <= Date.now() + 60_000;
  } catch {
    return false;
  }
}

/** Voices are read live from HeyGen (cached briefly), so new clones show up without a manual refresh. */
async function voices(type: "public" | "private", language: string | undefined, fresh: boolean): Promise<HeyGenVoice[]> {
  const key = `${type}:${language ?? ""}`;
  const hit = voiceCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < VOICE_TTL_MS) return hit.voices;
  const list = await listVoices(type, language);
  voiceCache.set(key, { at: Date.now(), voices: list });
  return list;
}

function page<T>(items: T[], req: express.Request) {
  const pageNo = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(60, Math.max(12, Number(req.query.limit ?? 48) || 48));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  return { slice: items.slice((pageNo - 1) * limit, pageNo * limit), total, page: pageNo, limit, pages };
}

export function registerAvatarRoutes(app: express.Express): void {
  app.get("/api/avatars", async (req, res) => {
    const ownership = req.query.ownership === "private" ? "private" : "public";
    let avatars: HeyGenAvatar[];
    if (ownership === "private") {
      // First visit: read the account's own avatars once instead of showing an empty tab.
      avatars = cachedPrivateAvatars();
      if (!fs.existsSync(PRIVATE_AVATAR_CATALOG) || avatars.some(expiredImage)) {
        try {
          privateRefresh ??= refreshPrivateAvatarCatalog().finally(() => { privateRefresh = undefined; });
          avatars = await privateRefresh;
        } catch (e) {
          return res.status(502).json({ error: (e as Error).message });
        }
      }
    } else avatars = cachedPublicAvatars();
    const q = String(req.query.q ?? "").toLowerCase().trim();
    if (req.query.portrait === "1") {
      avatars = avatars.filter((a) => `${a.preview_image_url ?? ""}${a.preview_video_url ?? ""}`.includes("preview_talk"));
    }
    // Exact match: a substring search for "male" would also return every "female" avatar.
    const gender = String(req.query.gender ?? "").toLowerCase();
    if (gender === "male" || gender === "female") {
      avatars = avatars.filter((a) => (a.gender ?? "").toLowerCase() === gender);
    }
    if (q) {
      avatars = avatars.filter((a) =>
        a.avatar_name.toLowerCase().includes(q) || a.avatar_id.toLowerCase().includes(q) || (a.gender ?? "").toLowerCase().includes(q));
    }
    const { slice, ...meta } = page(avatars, req);
    res.json({ avatars: slice, ownership, ...meta });
  });

  app.get("/api/avatars/count", (_req, res) => {
    res.json({ total: cachedPublicAvatars().length, private: cachedPrivateAvatars().length, source: "heygen-public-library" });
  });

  app.post("/api/avatars/refresh", async (_req, res) => {
    try {
      const { avatars, privateCount, privateError, defaultRepaired, defaultAvatarId } = await refreshAvatarCatalog();
      voiceCache.clear();
      res.json({
        avatars: avatars.slice(0, 48), total: avatars.length, page: 1, limit: 48, pages: Math.ceil(avatars.length / 48),
        privateCount, privateError, defaultRepaired, defaultAvatarId,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /**
   * The avatar's own voice, chosen automatically when the avatar is picked. All looks of one avatar
   * (same group) share it. The voice is spoken by HeyGen through its ElevenLabs engine (HEYGEN_VOICE_MODEL).
   */
  const avatarVoices = new Map<string, { voice: HeyGenVoice | null; groupId?: string }>();
  app.get("/api/heygen/avatars/:id/voice", async (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(id)) return res.status(400).json({ error: "Invalid avatar" });
    try {
      let hit = avatarVoices.get(id);
      if (!hit) {
        const look = await getAvatarLook(id);
        const voice = look.default_voice_id ? await getVoice(look.default_voice_id) : null;
        hit = { voice, groupId: look.group_id };
        avatarVoices.set(id, hit);
      }
      res.json({ avatarId: id, groupId: hit.groupId ?? null, voice: hit.voice, voiceModel: config.heygenVoiceModel() });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  /** HeyGen voices: type=private (your own) or public (HeyGen library, German by default). */
  app.get("/api/heygen/voices", async (req, res) => {
    const type = req.query.type === "public" ? "public" : "private";
    const language = type === "public" ? String(req.query.language ?? "German") || undefined : undefined;
    try {
      let list = await voices(type, language, req.query.fresh === "1");
      const gender = String(req.query.gender ?? "").toLowerCase();
      if (gender === "male" || gender === "female") list = list.filter((v) => v.gender === gender);
      const q = String(req.query.q ?? "").toLowerCase().trim();
      if (q) list = list.filter((v) => v.name.toLowerCase().includes(q) || v.voice_id.toLowerCase().includes(q));
      res.json({ voices: list, total: list.length, type, language: language ?? null });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });
}
