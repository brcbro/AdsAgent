import fs from "node:fs";
import path from "node:path";
import { AdProject, Briefing } from "./schema.js";
import { adDir, ensureDir } from "./paths.js";

export function loadBriefing(filePath: string): Briefing {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Briefing.parse(raw);
}

export function saveProject(project: AdProject): string {
  const dir = ensureDir(adDir(project.id));
  const file = path.join(dir, "project.json");
  fs.writeFileSync(file, JSON.stringify(project, null, 2), "utf-8");
  return file;
}

export function loadProject(adId: string): AdProject {
  const file = path.join(adDir(adId), "project.json");
  return AdProject.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
}
