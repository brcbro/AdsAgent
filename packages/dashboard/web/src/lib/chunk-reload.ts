import { lazy, type ComponentType } from "react";

/*
 * Every `vite build` renames the page bundles (PerformancePage-<hash>.js) and deletes the old
 * ones. A tab opened before a rebuild still asks for the old names and gets a 404 — or, behind
 * the hosted site's login, a redirect once the session has expired. Reloading fetches the new
 * index.html and the new names. Reload at most once per 30 s, so a real outage never loops.
 */

const KEY = "adFactory.chunkReloadAt";
const WINDOW_MS = 30_000;

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .* failed/i.test(message);
}

/** Reloads the page to pick up the current build. Returns false when it already tried recently. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No storage means no loop guard: leave it to the error screen's Reload button.
    return false;
  }
  window.location.reload();
  return true;
}

/** React.lazy that reloads once instead of failing when the page bundle was replaced by a new build. */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(() => load().catch((err: unknown) => {
    // While the reload happens, keep the Suspense fallback instead of flashing the error screen.
    if (isChunkLoadError(err) && reloadForNewBuild()) return new Promise<{ default: T }>(() => {});
    throw err;
  }));
}

/** Vite reports failed preloads of a lazy page's CSS/JS dependencies with this event. */
export function installPreloadErrorReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
