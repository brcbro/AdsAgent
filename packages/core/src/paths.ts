import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "./env.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Repo root = packages/core/src -> three levels up
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const BRIEFINGS_DIR = path.join(DATA_DIR, "briefings");
export const ADS_DIR = path.join(DATA_DIR, "ads");
/** HeyGen avatar clips reused across re-renders (`--skip-heygen`). */
export const AGENT_DIR = path.join(DATA_DIR, "agent");
export const BROLL_DIR = path.join(DATA_DIR, "broll");
export const MUSIC_DIR = path.join(DATA_DIR, "music");
/** Output root for finished videos. Set VIDEO_OUTPUT_DIR to keep renders outside the repo. */
export const VIDEO_DIR = process.env.VIDEO_OUTPUT_DIR
  ? path.resolve(process.env.VIDEO_OUTPUT_DIR)
  : path.join(REPO_ROOT, "video");
/** Active output session — all new renders go here (e.g. "16th June"). */
export function getVideoSession(): string {
  return process.env.VIDEO_SESSION ?? "16th June";
}

export const VIDEO_SESSION = getVideoSession();

export function getSessionVideoDir(): string {
  return path.join(VIDEO_DIR, getVideoSession());
}

export const SESSION_VIDEO_DIR = getSessionVideoDir();
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const REMOTION_DIR = path.join(REPO_ROOT, "packages", "remotion");
export const REMOTION_PUBLIC_ADS = path.join(REMOTION_DIR, "public", "ads");

export function sessionProjectDir(projectId: string): string {
  return path.join(getSessionVideoDir(), projectId);
}

/** Flat deliverable: `video/<session>/<id>.mp4` only — no sidecar files. */
export function sessionVideoFile(projectId: string): string {
  return path.join(getSessionVideoDir(), `${projectId}.mp4`);
}

/** Finished factory output — edited MP4s land here. */
export function getFinalVideoDir(): string {
  return path.join(VIDEO_DIR, "final");
}

export const FINAL_VIDEO_DIR = getFinalVideoDir();

export function finalVideoFile(projectId: string): string {
  return path.join(getFinalVideoDir(), `${projectId}.mp4`);
}

export function projectMetadataPath(projectId: string): string {
  return path.join(ADS_DIR, projectId, "metadata.json");
}

export function adDir(adId: string): string {
  return path.join(ADS_DIR, adId);
}

/** HeyGen avatar clip: `data/agent/{projectId}/main.mp4` */
export function agentClipPath(projectId: string): string {
  return path.join(AGENT_DIR, projectId, "main.mp4");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
