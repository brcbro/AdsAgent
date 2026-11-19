import fs from "node:fs";
import path from "node:path";
import { sessionVideoFile, finalVideoFile, ensureDir } from "@ai-ads/core";

/** Publish final MP4 to session folder + video/final/. */
export function publishToVideoFolder(adId: string, renderPath: string): string {
  for (const target of [sessionVideoFile(adId), finalVideoFile(adId)]) {
    ensureDir(path.dirname(target));
    const pending = `${target}.pending`;
    fs.copyFileSync(renderPath, pending);
    fs.renameSync(pending, target);
  }
  return finalVideoFile(adId);
}
