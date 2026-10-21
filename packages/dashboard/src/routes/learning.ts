import fs from "node:fs";
import path from "node:path";
import type express from "express";
import { REPO_ROOT } from "@ai-ads/core";

const LEARNING_FILE = path.join(REPO_ROOT, "data", "learning.jsonl");

/** Download events appended to the learning log. */
export function registerLearningRoutes(app: express.Express): void {
  app.post("/api/projects/:id/download", (req, res) => {
    const entry = {
      type: "download",
      projectId: req.params.id,
      ...req.body,
      timestamp: new Date().toISOString(),
    };
    try {
      fs.appendFileSync(LEARNING_FILE, JSON.stringify(entry) + "\n");
    } catch {}
    res.json({ ok: true });
  });
}
