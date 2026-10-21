import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { cachedAvatars } from "../../../pipeline/src/avatar-catalog.js";
import { ADS_DIR, CAPTION_PRESETS, DATA_DIR, DEFAULT_MUSIC, REPO_ROOT, SESSION_VIDEO_DIR, ProjectMetadata } from "@ai-ads/core";
import {
  config, listProjects, listRenderVersions, loadMetadata, publishToVideoFolder, renderVersionFile, saveMetadata,
} from "@ai-ads/pipeline";

const DEFAULT_SCRIPT =
  "Trading ohne System ist wie Fahren ohne Lenkrad — irgendwann crasht es. In unserem Training lernst du Schritt für Schritt, wie echte Profis denken und handeln. Klare Regeln, Risikomanagement, diszipliniertes Handeln. Kein Hype — nur Methodik, die funktioniert. Melde dich an und starte heute mit Struktur statt Bauchgefühl.";

const PROJECT_ID = /^[A-Za-z0-9_-]+$/;
/** Fields the pipeline owns; editor saves never overwrite them. */
const SERVER_FIELDS = ["status", "error", "outputFile", "createdAt"] as const;

/** True when the named env var is set — values are never sent to the browser. */
function configured(...names: string[]): boolean {
  return names.every((name) => !!process.env[name]);
}

const SAFE_FILE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)+$/;

/** Published copy first, then legacy folders, then the render inside the project folder itself. */
function projectFile(id: string, file: string): string | null {
  if (!PROJECT_ID.test(id) || !SAFE_FILE.test(file)) return null;
  const flat = path.join(SESSION_VIDEO_DIR, `${id}.mp4`);
  if (file === "final.mp4" && fs.existsSync(flat)) return flat;
  for (const base of [
    path.join(REPO_ROOT, "video", "16th June", id),
    path.join(REPO_ROOT, "video", id),
    path.join(ADS_DIR, id, "out"),
  ]) {
    const p = path.join(base, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Project metadata, caption presets and model settings (no credentials). */
export function registerProjectRoutes(app: express.Express): void {
  app.get("/api/projects", (_req, res) => {
    const ids = listProjects();
    const projects = ids
      .map((id) => {
        const meta = loadMetadata(id);
        if (meta) return meta;
        const hasVideo = fs.existsSync(path.join(SESSION_VIDEO_DIR, `${id}.mp4`));
        if (hasVideo) {
          return {
            id,
            title: id,
            scriptDe: DEFAULT_SCRIPT,
            introMs: 7000,
            avatarZoom: 1,
            avatar: { heygenAvatarId: "", name: "" },
            status: "done" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      })
      .filter(Boolean);
    projects.sort((a, b) => (b!.updatedAt ?? "").localeCompare(a!.updatedAt ?? ""));
    res.json(projects);
  });

  app.post("/api/projects", (req, res) => {
    const now = new Date().toISOString();
    const id = String(req.body.id ?? `video_${Date.now()}`);
    const meta = ProjectMetadata.parse({
      id,
      title: req.body.title ?? "New Video",
      scriptDe: req.body.scriptDe ?? DEFAULT_SCRIPT,
      introMs: req.body.introMs ?? 7000,
      avatarZoom: 1,
      aspectRatio: req.body.aspectRatio ?? "16:9",
      avatar: req.body.avatar ?? { heygenAvatarId: "", name: "" },
      music: { ...DEFAULT_MUSIC, ...(req.body.music ?? {}) },
      captions: req.body.captions ?? { presetId: "meta-clean", fontSize: 32 },
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    saveMetadata(meta);
    res.json(meta);
  });

  app.get("/api/projects/:id", (req, res) => {
    const meta = loadMetadata(req.params.id);
    if (!meta) return res.status(404).json({ error: "Not found" });
    res.json(meta);
  });

  // Editor saves: the URL decides the project, and pipeline-owned fields keep their on-disk values
  // so an autosave racing a render can never reset its status or output.
  app.put("/api/projects/:id/metadata", (req, res) => {
    const id = req.params.id;
    if (!PROJECT_ID.test(id)) return res.status(400).json({ error: "Invalid project id" });
    const existing = loadMetadata(id);
    if (!existing) return res.status(404).json({ error: "Project not found" });
    const merged: Record<string, unknown> = { ...existing, ...req.body, id };
    for (const field of SERVER_FIELDS) {
      if (existing[field] === undefined) delete merged[field];
      else merged[field] = existing[field];
    }
    merged.updatedAt = new Date().toISOString();
    if (!merged.music) merged.music = { ...DEFAULT_MUSIC };
    const result = ProjectMetadata.safeParse(merged);
    if (!result.success) return res.status(400).json({ error: "Invalid project settings", details: result.error.issues });
    saveMetadata(result.data);
    res.json(result.data);
  });

  /** Archive instead of delete: the project folder and published MP4 move to data/archive and can be restored by hand. */
  app.post("/api/projects/:id/archive", (req, res) => {
    const id = req.params.id;
    if (!PROJECT_ID.test(id)) return res.status(400).json({ error: "Invalid project id" });
    const meta = loadMetadata(id);
    if (meta?.status === "generating" || meta?.status === "rendering") {
      return res.status(409).json({ error: "Stop the render before archiving this project" });
    }
    const archiveDir = path.join(DATA_DIR, "archive", `${id}_${Date.now()}`);
    const moves: Array<[string, string]> = [
      [path.join(ADS_DIR, id), path.join(archiveDir, "project")],
      [path.join(SESSION_VIDEO_DIR, `${id}.mp4`), path.join(archiveDir, `${id}.mp4`)],
    ];
    const present = moves.filter(([from]) => fs.existsSync(from));
    if (!present.length) return res.status(404).json({ error: "Project not found" });
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const [from, to] of present) fs.renameSync(from, to);
    res.json({ ok: true, archivedTo: path.relative(REPO_ROOT, archiveDir) });
  });

  app.get("/api/projects/:id/versions", (req, res) => {
    if (!PROJECT_ID.test(req.params.id)) return res.status(400).json({ error: "Invalid project id" });
    res.json(listRenderVersions(req.params.id));
  });

  app.get("/api/projects/:id/versions/:versionId/video", (req, res) => {
    if (!PROJECT_ID.test(req.params.id)) return res.status(400).end();
    const file = renderVersionFile(req.params.id, req.params.versionId);
    if (!file) return res.status(404).end();
    res.sendFile(file);
  });

  /*
   * Make an older render the current video and bring back its caption, music, B-roll and export
   * settings. The script and presenter stay as they are: Apply edits reuses the latest saved
   * narration and footage, which belong to the current script.
   */
  app.post("/api/projects/:id/versions/:versionId/restore", (req, res) => {
    const id = req.params.id;
    if (!PROJECT_ID.test(id)) return res.status(400).json({ error: "Invalid project id" });
    const meta = loadMetadata(id);
    if (!meta) return res.status(404).json({ error: "Project not found" });
    if (meta.status === "generating" || meta.status === "rendering") {
      return res.status(409).json({ error: "Wait for the current render to finish" });
    }
    const version = listRenderVersions(id).find((v) => v.id === req.params.versionId);
    const source = version && renderVersionFile(id, version.id);
    if (!version || !source) return res.status(404).json({ error: "Version not found" });

    const target = path.join(ADS_DIR, id, "out", "final.mp4");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    publishToVideoFolder(id, target);

    const { scriptDe: _script, avatar: _avatar, title: _title, ...presentation } = version.settings;
    const restored = ProjectMetadata.safeParse({
      ...meta, ...presentation, status: "done", error: undefined, outputFile: target, updatedAt: new Date().toISOString(),
    });
    if (!restored.success) return res.status(400).json({ error: "This version's settings are no longer valid" });
    saveMetadata(restored.data);
    res.json({ project: restored.data, scriptChanged: (version.settings.scriptDe ?? "") !== meta.scriptDe });
  });

  app.get("/api/caption-presets", (_req, res) => {
    res.json(CAPTION_PRESETS);
  });

  // Display only model settings; credentials never leave the server.
  app.get("/api/studio-config", (_req, res) => {
    const defaultAvatar = cachedAvatars().find(a => a.avatar_id === process.env.HEYGEN_AVATAR_ID);
    res.json({
      heygenApiVersion: "v3", defaultAvatar,
      scriptModel: config.llmProvider() === "anthropic" ? config.anthropicModel() : config.openRouterModel(),
      voiceModel: config.elevenLabsModel(),
      voiceLanguage: config.elevenLabsLanguage() === "de" ? "German (de)" : config.elevenLabsLanguage(),
      llmProvider: config.llmProvider(),
      outputFolder: path.relative(REPO_ROOT, SESSION_VIDEO_DIR) || SESSION_VIDEO_DIR,
      services: {
        scripts: config.llmProvider() === "anthropic" ? configured("ANTHROPIC_API_KEY") : configured("OPENROUTER_API_KEY"),
        voice: configured("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"),
        avatar: configured("HEYGEN_API_KEY"),
      },
    });
  });

  app.get("/api/projects/:id/beats", (req, res) => {
    const p = projectFile(req.params.id, "beats.json");
    if (!p) return res.json({ introMs: 6000, beats: [] });
    res.json(JSON.parse(fs.readFileSync(p, "utf-8")));
  });

  app.get("/api/video/:id/:file", (req, res) => {
    const file = projectFile(req.params.id, req.params.file);
    if (!file) return res.status(404).end();
    res.sendFile(file);
  });
}
