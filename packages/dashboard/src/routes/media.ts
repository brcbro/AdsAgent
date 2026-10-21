import fs from "node:fs";
import path from "node:path";
import express from "express";
import { REPO_ROOT, listMusicTracksForApi } from "@ai-ads/core";

/** Music tracks, B-roll catalog and the static /data folder. */
export function registerMediaRoutes(app: express.Express): void {
  app.get("/api/music-tracks", (_req, res) => {
    res.json(listMusicTracksForApi());
  });

  app.get("/api/broll/catalog", (_req, res) => {
    const cat = path.join(REPO_ROOT, "data/broll/catalog.json");
    if (!fs.existsSync(cat)) return res.json([]);
    const entries = JSON.parse(fs.readFileSync(cat, "utf-8")) as Array<{ file: string; preview: string }>;
    const dataUrl = (file: string): string | null => {
      const normalized = file.replace(/\\/g, "/");
      const absolute = path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, normalized);
      const relative = path.relative(path.join(REPO_ROOT, "data"), absolute).replace(/\\/g, "/");
      if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
      return "/data/" + relative.split("/").map(encodeURIComponent).join("/");
    };
    res.json(entries.map(entry => ({ ...entry, clipUrl: dataUrl(entry.file), previewUrl: dataUrl(entry.preview) })));
  });

  app.use("/data", express.static(path.join(REPO_ROOT, "data")));
}
