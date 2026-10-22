import path from "node:path";
import express from "express";
import { REPO_ROOT, listMusicTracksForApi } from "@ai-ads/core";

/** Music tracks and the static /data folder. The B-roll catalog lives in routes/broll.ts. */
export function registerMediaRoutes(app: express.Express): void {
  app.get("/api/music-tracks", (_req, res) => {
    res.json(listMusicTracksForApi());
  });

  app.use("/data", express.static(path.join(REPO_ROOT, "data")));
}
