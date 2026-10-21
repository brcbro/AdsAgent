import fs from "node:fs";
import path from "node:path";
import { adDir, ensureDir, type ProjectMetadata } from "@ai-ads/core";

/** Older renders beyond this are deleted, newest kept — each version is a full MP4. */
export const MAX_RENDER_VERSIONS = 10;

/** Settings that shaped a render; stored with each version so versions can be compared and restored. */
export const VERSION_SETTING_FIELDS = [
  "title", "scriptDe", "aspectRatio", "outputSpeed", "introMs", "fullAvatar", "brollCutMs",
  "avatar", "music", "captions", "brollPinned", "brollExcluded",
] as const;

export type VersionSettings = Partial<Pick<ProjectMetadata, (typeof VERSION_SETTING_FIELDS)[number]>>;

export interface RenderVersion {
  id: string;
  createdAt: string;
  file: string;
  sizeBytes: number;
  settings: VersionSettings;
}

const VERSION_ID = /^v_\d{13}(_\d+)?$/;

function versionsDir(projectDir: string): string {
  return path.join(projectDir, "versions");
}

function indexPath(projectDir: string): string {
  return path.join(versionsDir(projectDir), "index.json");
}

export function settingsSnapshot(meta: ProjectMetadata): VersionSettings {
  const snapshot: Record<string, unknown> = {};
  for (const field of VERSION_SETTING_FIELDS) {
    if (meta[field] !== undefined) snapshot[field] = structuredClone(meta[field]);
  }
  return snapshot as VersionSettings;
}

/** Newest first. Entries whose MP4 is missing are dropped. */
export function listRenderVersions(projectId: string, projectDir = adDir(projectId)): RenderVersion[] {
  const file = indexPath(projectDir);
  if (!fs.existsSync(file)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf-8")) as RenderVersion[];
    return list.filter((v) => VERSION_ID.test(v.id) && fs.existsSync(path.join(versionsDir(projectDir), v.file)));
  } catch {
    return [];
  }
}

/** Absolute path of a version's MP4, or null for unknown / malformed ids. */
export function renderVersionFile(projectId: string, versionId: string, projectDir = adDir(projectId)): string | null {
  if (!VERSION_ID.test(versionId)) return null;
  const version = listRenderVersions(projectId, projectDir).find((v) => v.id === versionId);
  return version ? path.join(versionsDir(projectDir), version.file) : null;
}

/** Copy a finished render into the project's version history and prune the oldest beyond the limit. */
export function saveRenderVersion(
  meta: ProjectMetadata,
  renderPath: string,
  projectDir = adDir(meta.id),
  now = Date.now(),
): RenderVersion {
  const dir = ensureDir(versionsDir(projectDir));
  const existing = listRenderVersions(meta.id, projectDir);
  let id = `v_${now}`;
  for (let n = 1; existing.some((v) => v.id === id); n++) id = `v_${now}_${n}`;
  const file = `${id}.mp4`;
  fs.copyFileSync(renderPath, path.join(dir, file));
  const version: RenderVersion = {
    id,
    createdAt: new Date(now).toISOString(),
    file,
    sizeBytes: fs.statSync(path.join(dir, file)).size,
    settings: settingsSnapshot(meta),
  };
  const all = [version, ...existing];
  for (const old of all.slice(MAX_RENDER_VERSIONS)) fs.rmSync(path.join(dir, old.file), { force: true });
  fs.writeFileSync(indexPath(projectDir), JSON.stringify(all.slice(0, MAX_RENDER_VERSIONS), null, 2));
  return version;
}
