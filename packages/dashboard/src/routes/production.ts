import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type express from "express";
import { DEFAULT_MUSIC, REMOTION_PUBLIC_ADS, REPO_ROOT, adDir, ProjectMetadata } from "@ai-ads/core";
import { config, loadMetadata, saveMetadata } from "@ai-ads/pipeline";
import type { DashboardContext } from "../context.js";
import { renderState, startPipeline, startProduce } from "../render-state.js";

function hasSourceClip(projectId: string): boolean {
  return fs.existsSync(path.join(adDir(projectId), "main.mp4"));
}

function clearProjectCache(projectId: string): void {
  const main = path.join(adDir(projectId), "main.mp4");
  if (fs.existsSync(main)) fs.unlinkSync(main);
  const pub = path.join(REMOTION_PUBLIC_ADS, projectId);
  if (fs.existsSync(pub)) fs.rmSync(pub, { recursive: true, force: true });
}

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

  /** Save form + produce video with selected avatar (HeyGen + Remotion + B-roll + music). */
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
    meta.status = "generating";
    meta.updatedAt = new Date().toISOString();
    meta.music = mergeMusic(meta);
    delete meta.music!.startOffsetMs;
    if (!meta.captions) meta.captions = { presetId: "meta-clean", fontSize: 32 };
    if (!meta.createdAt) meta.createdAt = new Date().toISOString();

    saveMetadata(meta);
    clearProjectCache(meta.id);
    startProduce(meta.id, { shuffleBroll: true });

    res.json({ ok: true, status: "started", id: meta.id });
  });

  /** Create a separate local preview from the editor; only ElevenLabs can be called. */
  app.post("/api/projects/:id/local-preview", (req, res) => {
    if (isRendering()) return res.status(409).json({ error: "A render is already in progress" });
    if (!/^[A-Za-z0-9_-]+$/.test(req.params.id) || !loadMetadata(req.params.id)) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (typeof req.body.scriptDe !== "string" || !req.body.scriptDe.trim()) {
      return res.status(400).json({ error: "Enter a German script first" });
    }
    const catalogPath = path.join(REPO_ROOT, "data/broll/catalog.json");
    if (!fs.existsSync(catalogPath) || !JSON.parse(fs.readFileSync(catalogPath, "utf8")).length) {
      return res.status(400).json({ error: "Add B-roll clips to the library first" });
    }
    try {
      config.elevenLabsApiKey();
      config.elevenLabsVoiceId();
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
    const now = new Date().toISOString();
    const result = ProjectMetadata.safeParse({
      ...req.body,
      id: `local_${randomUUID().replace(/-/g, "")}`,
      title: `${req.body.title || "German Video"} — Local Preview`,
      scriptDe: req.body.scriptDe.trim(),
      introMs: 3000,
      fullAvatar: false,
      fastCuts: false,
      avatar: { heygenAvatarId: "", name: "Local waveform preview" },
      muteAvatar: false,
      avatarVolume: 1,
      music: mergeMusic(req.body),
      status: "generating",
      error: undefined,
      outputFile: undefined,
      createdAt: now,
      updatedAt: now,
    });
    if (!result.success) return res.status(400).json({ error: "Invalid preview settings", details: result.error.issues });
    const meta = result.data;
    if (meta.music) delete meta.music.startOffsetMs;
    saveMetadata(meta);
    startPipeline(meta.id, ["--filter", "@ai-ads/pipeline", "run", "local-preview", meta.id, req.params.id]);
    res.json({ ok: true, id: meta.id, project: meta });
  });

  /** Re-render captions/music only — reuses HeyGen clip + B-roll (no new avatar generation). */
  app.post("/api/projects/:id/recaption", (req, res) => {
    if (isRendering()) return res.status(409).json({ error: "A render is already in progress" });

    const meta = req.body as ProjectMetadata;
    if (!hasSourceClip(req.params.id)) {
      return res.status(400).json({
        error: "No saved source clip — create a local preview or avatar video first",
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

  app.post("/api/render/cancel", (req, res) => {
    const projectId = String(req.body?.projectId ?? renderState.activeProjectId ?? "");
    agentDashboard.cancelProject(projectId);
    const child = renderState.activeChild;
    if (child) {
      child.kill("SIGTERM");
      // Capture the child before it is cleared below, so the force-kill still reaches it.
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }
    renderState.rendering = false;
    renderState.activeChild = null;
    if (projectId) {
      const meta = loadMetadata(projectId);
      if (meta && meta.status !== "done") {
        meta.status = "draft";
        delete meta.error;
        meta.updatedAt = new Date().toISOString();
        saveMetadata(meta);
      }
    }
    renderState.activeProjectId = null;
    renderState.startedAt = null;
    renderState.lastLine = null;
    res.json({ ok: true });
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
