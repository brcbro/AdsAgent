import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@ai-ads/core";
import { dedupeAvatars, getAvatarLook, isPublicHeyGenAvatar, listPublicAvatars, type HeyGenAvatar } from "./heygen.js";

export const AVATAR_CATALOG = path.join(REPO_ROOT, "data", "avatars.json");
export function cachedAvatars(): HeyGenAvatar[] {
  if (!fs.existsSync(AVATAR_CATALOG)) return [];
  return dedupeAvatars((JSON.parse(fs.readFileSync(AVATAR_CATALOG, "utf8")) as HeyGenAvatar[]).filter(isPublicHeyGenAvatar));
}
export async function refreshAvatarCatalog(onPage?: (count: number) => void): Promise<{ avatars: HeyGenAvatar[]; defaultAvatarId: string; defaultRepaired: boolean }> {
  const avatars = (await listPublicAvatars(onPage)).filter(a => !a.status || ["completed", "ready"].includes(a.status));
  if (!avatars.length) throw new Error("HeyGen returned no available public avatars. The existing catalog was kept.");
  let defaultId = process.env.HEYGEN_AVATAR_ID || "";
  let valid = avatars.some(a => a.avatar_id === defaultId);
  if (!valid && defaultId) {
    try { await getAvatarLook(defaultId); valid = true; }
    catch (err) { if (!String(err).includes("HeyGen 404")) throw err; }
  }
  const defaultRepaired = !valid;
  if (defaultRepaired) {
    const chosen = avatars.find(a => a.avatar_id === "Brandon_Kitchen_Standing_Front_public")
      ?? avatars.find(a => a.gender?.toLowerCase() === "male") ?? avatars[0];
    defaultId = chosen.avatar_id;
    const envPath = path.join(REPO_ROOT, ".env");
    const previous = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    const line = `HEYGEN_AVATAR_ID=${defaultId}`;
    const updated = /^HEYGEN_AVATAR_ID=.*$/m.test(previous) ? previous.replace(/^HEYGEN_AVATAR_ID=.*$/m, line) : `${previous.trimEnd()}\n${line}\n`;
    fs.writeFileSync(envPath, updated);
    process.env.HEYGEN_AVATAR_ID = defaultId;
  }
  fs.mkdirSync(path.dirname(AVATAR_CATALOG), { recursive: true });
  fs.writeFileSync(`${AVATAR_CATALOG}.tmp`, JSON.stringify(avatars, null, 2));
  fs.renameSync(`${AVATAR_CATALOG}.tmp`, AVATAR_CATALOG);
  return { avatars, defaultAvatarId: defaultId, defaultRepaired };
}
