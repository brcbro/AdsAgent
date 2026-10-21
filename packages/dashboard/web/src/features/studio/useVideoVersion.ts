import { useEffect, useRef, useSyncExternalStore } from "react";
import { isBusy } from "@/lib/format";
import type { Project } from "@/lib/types";

// Survives remounts so returning to a project doesn't reload its video.
const versions = new Map<string, string>();
const listeners = new Set<() => void>();

/** Point the player at a new file for this project (after a render finishes or a version is restored). */
export function bumpVideoVersion(projectId: string) {
  versions.set(projectId, String(Date.now()));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/*
 * Cache key for a project's MP4. It changes only when the video itself changes, so autosaves,
 * avatar changes and format switches never restart playback.
 */
export function useVideoVersion(project: Project | undefined): string | undefined {
  const prevStatus = useRef<{ id: string; status: Project["status"] } | null>(null);

  if (project && !versions.has(project.id)) versions.set(project.id, project.updatedAt);
  const version = useSyncExternalStore(subscribe, () => (project ? versions.get(project.id) : undefined));

  useEffect(() => {
    if (!project) return;
    const prev = prevStatus.current;
    if (prev?.id === project.id && isBusy(prev.status) && project.status === "done") bumpVideoVersion(project.id);
    prevStatus.current = { id: project.id, status: project.status };
  }, [project?.id, project?.status]);

  return version;
}
