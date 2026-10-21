import { useCallback, useSyncExternalStore } from "react";
import type { AspectRatio } from "./types";

/*
 * Per-browser preferences in localStorage. Every access is guarded: storage can be blocked or
 * missing (private windows), and the app must work with defaults when it is.
 */

export interface SavedAvatar { id: string; name: string; image?: string; gender?: string }

export type ThemePref = "light" | "dark" | "system";

export interface Prefs {
  theme: ThemePref;
  defaultPresetId: string;
  defaultAspectRatio: AspectRatio;
  confirmSpend: boolean;
  skipLocalPreviewConfirm: boolean;
  sidebarCollapsed: boolean;
  inspectorWidth: number;
  favoritePresets: string[];
  favoriteAvatars: SavedAvatar[];
  recentAvatars: SavedAvatar[];
  agentSessionId: string | null;
}

const DEFAULTS: Prefs = {
  // The studio is designed white-first; dark is opt-in.
  theme: "light",
  defaultPresetId: "meta-clean",
  defaultAspectRatio: "9:16",
  confirmSpend: true,
  skipLocalPreviewConfirm: false,
  sidebarCollapsed: false,
  inspectorWidth: 380,
  favoritePresets: [],
  favoriteAvatars: [],
  recentAvatars: [],
  agentSessionId: null,
};

const KEY = "adFactory.prefs.v1";
const listeners = new Set<() => void>();
let cache: Prefs = load();

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    // Older single-key value from the previous dashboard.
    const legacySession = localStorage.getItem("agentSessionId");
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return { ...DEFAULTS, agentSessionId: legacySession, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getPrefs(): Prefs {
  return cache;
}

export function setPrefs(patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)): void {
  const next = { ...cache, ...(typeof patch === "function" ? patch(cache) : patch) };
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrefs(): [Prefs, typeof setPrefs] {
  const prefs = useSyncExternalStore(subscribe, getPrefs, getPrefs);
  return [prefs, setPrefs];
}

export function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (value: Prefs[K]) => void] {
  const value = useSyncExternalStore(subscribe, () => cache[key], () => cache[key]);
  const set = useCallback((v: Prefs[K]) => setPrefs({ [key]: v } as Partial<Prefs>), [key]);
  return [value, set];
}

/** Last ten saved versions of each project's script, newest first. */
const HISTORY_KEY = "adFactory.scriptHistory.v1";
type ScriptHistory = Record<string, Array<{ at: string; text: string }>>;

export function readScriptHistory(projectId: string): Array<{ at: string; text: string }> {
  try {
    return (JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as ScriptHistory)[projectId] ?? [];
  } catch {
    return [];
  }
}

export function pushScriptHistory(projectId: string, text: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "{}") as ScriptHistory;
    const list = all[projectId] ?? [];
    if (list[0]?.text === text) return;
    all[projectId] = [{ at: new Date().toISOString(), text }, ...list].slice(0, 10);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch { /* history is a convenience only */ }
}
