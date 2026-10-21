import fs from "node:fs";
import path from "node:path";
import { sessionVideoFile, finalVideoFile, ensureDir } from "@ai-ads/core";

/** Publish final MP4 to session folder + video/final/. */
export function publishToVideoFolder(adId: string, renderPath: string): string {
  ensureDir(path.dirname(sessionVideoFile(adId)));
  fs.copyFileSync(renderPath, sessionVideoFile(adId));
  ensureDir(path.dirname(finalVideoFile(adId)));
  fs.copyFileSync(renderPath, finalVideoFile(adId));
  return finalVideoFile(adId);
}
