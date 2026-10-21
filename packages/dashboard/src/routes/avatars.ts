import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { REPO_ROOT } from "@ai-ads/core";
import { dedupeAvatars, isPublicHeyGenAvatar } from "@ai-ads/pipeline";
import type { HeyGenAvatar } from "@ai-ads/pipeline";
import { refreshAvatarCatalog } from "../../../pipeline/src/avatar-catalog.js";

const AVATARS_CACHE = path.join(REPO_ROOT, "data", "avatars.json");

function loadCachedPublicAvatars(): HeyGenAvatar[] {
  if (!fs.existsSync(AVATARS_CACHE)) return [];
  const raw = JSON.parse(fs.readFileSync(AVATARS_CACHE, "utf-8")) as HeyGenAvatar[];
  return dedupeAvatars(raw.filter(isPublicHeyGenAvatar));
}

export function registerAvatarRoutes(app: express.Express): void {
  app.get("/api/avatars", (req, res) => {
    let avatars = loadCachedPublicAvatars();
    const q = String(req.query.q ?? "").toLowerCase().trim();
    const portraitOnly = req.query.portrait === "1";
    if (portraitOnly) {
      avatars = avatars.filter(
        (a) =>
          `${a.preview_image_url ?? ""}${a.preview_video_url ?? ""}`.includes("preview_talk"),
      );
    }
    // Exact match: a substring search for "male" would also return every "female" avatar.
    const gender = String(req.query.gender ?? "").toLowerCase();
    if (gender === "male" || gender === "female") {
      avatars = avatars.filter((a) => (a.gender ?? "").toLowerCase() === gender);
    }
    if (q) {
      avatars = avatars.filter(
        (a) =>
          a.avatar_name.toLowerCase().includes(q) ||
          a.avatar_id.toLowerCase().includes(q) ||
          (a.gender ?? "").toLowerCase().includes(q),
      );
    }
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(60, Math.max(12, Number(req.query.limit ?? 48)));
    const total = avatars.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const slice = avatars.slice((page - 1) * limit, page * limit);
    res.json({ avatars: slice, total, page, limit, pages });
  });

  app.get("/api/avatars/count", (_req, res) => {
    const avatars = loadCachedPublicAvatars();
    res.json({ total: avatars.length, source: "heygen-public-library" });
  });

  app.post("/api/avatars/refresh", async (_req, res) => {
      try {
        const { avatars, defaultRepaired, defaultAvatarId } = await refreshAvatarCatalog();
        res.json({
          avatars: avatars.slice(0, 48),
          total: avatars.length,
          page: 1,
          limit: 48,
          pages: Math.ceil(avatars.length / 48),
          defaultRepaired, defaultAvatarId,
        });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
  });
}
