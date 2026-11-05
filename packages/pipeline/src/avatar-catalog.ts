import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@ai-ads/core";
import { dedupeAvatars, getAvatarLook, isPublicHeyGenAvatar, listPrivateAvatars, listPublicAvatars, normalizeGender, type HeyGenAvatar } from "./heygen.js";

export const AVATAR_CATALOG = path.join(REPO_ROOT, "data", "avatars.json");
/** The account's own HeyGen avatars (digital twins, photo avatars, custom studio avatars). */
export const PRIVATE_AVATAR_CATALOG = path.join(REPO_ROOT, "data", "avatars-private.json");

const ready = (a: HeyGenAvatar) => !a.status || ["completed", "ready"].includes(a.status);

function readCatalog(file: string): HeyGenAvatar[] {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as HeyGenAvatar[]; } catch { return []; }
}
function writeCatalog(file: string, avatars: HeyGenAvatar[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(avatars, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export function cachedPublicAvatars(): HeyGenAvatar[] {
  return dedupeAvatars(readCatalog(AVATAR_CATALOG).filter(isPublicHeyGenAvatar));
}
export function cachedPrivateAvatars(): HeyGenAvatar[] {
  return dedupeAvatars(readCatalog(PRIVATE_AVATAR_CATALOG).map(a => ({ ...a, gender: normalizeGender(a.gender), ownership: "private" as const })));
}
/** Own avatars first, then the public library. */
export function cachedAvatars(ownership: "public" | "private" | "all" = "all"): HeyGenAvatar[] {
  if (ownership === "public") return cachedPublicAvatars();
  if (ownership === "private") return cachedPrivateAvatars();
  return dedupeAvatars([...cachedPrivateAvatars(), ...cachedPublicAvatars()]);
}

/** Re-reads the account's own avatars. Kept separate so a failure never replaces the public catalog. */
export async function refreshPrivateAvatarCatalog(): Promise<HeyGenAvatar[]> {
  const avatars = (await listPrivateAvatars()).filter(ready);
  writeCatalog(PRIVATE_AVATAR_CATALOG, avatars);
  return avatars;
}

export async function refreshAvatarCatalog(onPage?: (count: number) => void): Promise<{ avatars: HeyGenAvatar[]; privateCount: number; privateError?: string; defaultAvatarId: string; defaultRepaired: boolean }> {
  const avatars = (await listPublicAvatars(onPage)).filter(ready);
  if (!avatars.length) throw new Error("HeyGen returned no available public avatars. The existing catalog was kept.");
  let privateAvatars: HeyGenAvatar[] = cachedPrivateAvatars(); let privateError: string | undefined;
  try { privateAvatars = await refreshPrivateAvatarCatalog(); }
  catch (err) { privateError = (err as Error).message; }
  let defaultId = process.env.HEYGEN_AVATAR_ID || "";
  let valid = avatars.some(a => a.avatar_id === defaultId) || privateAvatars.some(a => a.avatar_id === defaultId);
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
  writeCatalog(AVATAR_CATALOG, avatars);
  return { avatars, privateCount: privateAvatars.length, privateError, defaultAvatarId: defaultId, defaultRepaired };
}
