import type express from "express";
import { DEFAULT_MUSIC, ProjectMetadata, savedAvatarClip } from "@ai-ads/core";
import { loadMetadata, saveMetadata } from "@ai-ads/pipeline";
import type { DashboardContext } from "../context.js";
import { renderState, restoreCanceledRender, startProduce, stopProduce } from "../render-state.js";

function mergeMusic(meta: ProjectMetadata): NonNullable<ProjectMetadata["music"]> {
  return {
    ...DEFAULT_MUSIC,
    ...meta.music,
    enabled: meta.music?.enabled !== false,
    volume: meta.music?.volume ?? 0.25,
    file: meta.music?.file ?? DEFAULT_MUSIC.file,
  };
}

/** Manual render, preview and cancel endpoints. Only one pipeline child runs at a time. */
export function registerProductionRoutes(app: express.Express, ctx: DashboardContext): void {
  const { isRendering, agent: agentDashboard } = ctx;

  /** Save form + produce video with the selected HeyGen avatar and voice, then B-roll, captions and music. */
  app.post("/api/projects/:id/send", (req, res) => {
    if (isRendering()) return res.status(409).json({ error: "A render is already in progress" });

    const meta = req.body as ProjectMetadata;
    if (!meta.avatar?.heygenAvatarId) {
      return res.status(400).json({ error: "Select an avatar first" });
    }
    if (!meta.scriptDe?.trim()) {
      return res.status(400).json({ error: "Script is required" });
    }

    meta.id = req.params.id;
    // Avatar videos: presenter for the hook, then B-roll for the body (no fixed length or whole-video mode).
    meta.avatarUntil = "hook";
    meta.fullAvatar = false;
    meta.status = "generating";
    meta.updatedAt = new Date().toISOString();
    meta.music = mergeMusic(meta);
    delete meta.music!.startOffsetMs;
    if (!meta.captions) meta.captions = { presetId: "meta-clean", fontSize: 32 };
    if (!meta.createdAt) meta.createdAt = new Date().toISOString();

    saveMetadata(meta);
    startProduce(meta.id, { shuffleBroll: true });

    res.json({ ok: true, status: "started", id: meta.id });
  });

  /** Re-render captions/music only — reuses HeyGen clip + B-roll (no new avatar generation). */
  app.post("/api/projects/:id/recaption", (req, res) => {
    if (isRendering()) return res.status(409).json({ error: "A render is already in progress" });

    const meta = req.body as ProjectMetadata;
    if (!savedAvatarClip(req.params.id)) {
      return res.status(400).json({
        error: "No saved source clip — create an avatar video first",
      });
    }

    meta.id = req.params.id;
    meta.status = "rendering";
    meta.updatedAt = new Date().toISOString();
    meta.music = mergeMusic(meta);
    delete meta.music!.startOffsetMs;
    if (!meta.captions) meta.captions = { presetId: "meta-clean", fontSize: 32 };
    if (!meta.createdAt) meta.createdAt = loadMetadata(meta.id)?.createdAt ?? new Date().toISOString();

    saveMetadata(meta);
    startProduce(meta.id, { skipHeygen: true });

    res.json({ ok: true, status: "recaption", id: meta.id });
  });

  app.get("/api/render-status", (_req, res) => {
    const agent = agentDashboard.active();
    res.json({
      rendering: isRendering(),
      projectId: renderState.activeProjectId ?? agent?.projectId,
      source: renderState.rendering ? "editor" : agent ? "agent" : null,
      startedAt: renderState.startedAt,
      lastLine: renderState.lastLine,
    });
  });

  app.post("/api/render/cancel", async (req, res, next) => {
    const projectId = String(req.body?.projectId ?? renderState.activeProjectId ?? agentDashboard.active()?.projectId ?? "");
    try {
      if (projectId === renderState.activeProjectId) await stopProduce();
      else if (projectId === agentDashboard.active()?.projectId) await agentDashboard.cancelProject(projectId);
      else if (!isRendering() && /^[A-Za-z0-9_-]+$/.test(projectId)) {
        const meta = loadMetadata(projectId);
        if (meta?.status === "generating" || meta?.status === "rendering") restoreCanceledRender(projectId);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/projects/:id/render", async (req, res) => {
    if (isRendering()) return res.status(409).json({ error: "Render already in progress" });
    const meta = loadMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: "Not found" });

    meta.status = "generating";
    saveMetadata(meta);
    res.json({ ok: true, status: "started" });

    startProduce(meta.id, {
      skipHeygen: !!req.body?.skipHeygen,
      shuffleBroll: !!req.body?.shuffleBroll,
    });
  });
}
