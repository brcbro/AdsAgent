import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { isBusy } from "@/lib/format";
import { pushScriptHistory } from "@/lib/prefs";
import { keys } from "@/lib/queries";
import { EDITABLE_FIELDS, type Project, type ProjectDraft } from "@/lib/types";

export type SaveState = "saved" | "dirty" | "saving" | "error";

function pickDraft(project: Project): ProjectDraft {
  const draft = {} as Record<string, unknown>;
  for (const field of EDITABLE_FIELDS) draft[field] = project[field];
  return draft as ProjectDraft;
}

const AUTOSAVE_MS = 800;

/*
 * Editor state for one project. Edits live in a local draft that is autosaved shortly after the
 * user stops typing; server refreshes (polling while rendering) only replace the draft when there
 * are no unsaved edits, so polling can never overwrite work in progress. Switching projects or
 * leaving the page flushes pending edits first.
 */
export function useProjectDraft(project: Project | undefined) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<ProjectDraft | null>(project ? pickDraft(project) : null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const draftFor = useRef<string | undefined>(project?.id);
  const draftRef = useRef(draft);
  const stateRef = useRef(saveState);
  draftRef.current = draft;
  stateRef.current = saveState;

  const busy = isBusy(project?.status);

  const persist = useCallback(async (id: string, snapshot: ProjectDraft, quiet = false) => {
    setSaveState((s) => (draftFor.current === id ? "saving" : s));
    try {
      const saved = await api.saveProject(id, snapshot);
      client.setQueryData(keys.project(id), saved);
      client.setQueryData<Project[]>(keys.projects, (list) => list?.map((p) => (p.id === id ? saved : p)));
      pushScriptHistory(id, snapshot.scriptDe);
      // Only mark clean if nothing changed while the request was in flight.
      if (draftFor.current === id) setSaveState(draftRef.current === snapshot ? "saved" : "dirty");
      return true;
    } catch (err) {
      if (draftFor.current === id) setSaveState("error");
      if (!quiet) toast.error("Couldn't save your changes", { description: errorMessage(err) });
      return false;
    }
  }, [client]);

  // Load a new project, or adopt a server refresh when there are no local edits.
  useEffect(() => {
    if (!project) return;
    if (draftFor.current !== project.id) {
      draftFor.current = project.id;
      setDraft(pickDraft(project));
      setSaveState("saved");
      return;
    }
    if (stateRef.current === "saved") setDraft(pickDraft(project));
  }, [project]);

  // Debounced autosave. Paused while rendering: the render request already carries the edits.
  useEffect(() => {
    if (saveState !== "dirty" || !draft || !draftFor.current || busy) return;
    const id = draftFor.current;
    const timer = setTimeout(() => void persist(id, draft), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, saveState, busy, persist]);

  // Flush unsaved edits when switching to another project or leaving the Studio.
  useEffect(() => {
    const id = project?.id;
    return () => {
      if (id && stateRef.current === "dirty" && draftRef.current) void persist(id, draftRef.current, true);
    };
  }, [project?.id, persist]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (stateRef.current === "dirty" || stateRef.current === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /** Merge a patch into the draft; pass a function to derive the patch from the latest draft. */
  const update = useCallback((patch: Partial<ProjectDraft> | ((d: ProjectDraft) => Partial<ProjectDraft>)) => {
    setDraft((d) => (d ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d));
    setSaveState("dirty");
  }, []);

  const updateCaptions = useCallback((patch: NonNullable<ProjectDraft["captions"]>) => {
    setDraft((d) => (d ? { ...d, captions: { ...d.captions, ...patch } } : d));
    setSaveState("dirty");
  }, []);

  const updateMusic = useCallback((patch: NonNullable<ProjectDraft["music"]>) => {
    setDraft((d) => (d ? { ...d, music: { ...d.music, ...patch } } : d));
    setSaveState("dirty");
  }, []);

  const saveNow = useCallback(async () => {
    if (!draftFor.current || !draftRef.current) return true;
    if (stateRef.current === "saved") return true;
    return persist(draftFor.current, draftRef.current);
  }, [persist]);

  /** The project as it should be rendered: server copy plus current edits. */
  const merged = useCallback((): Project | null => {
    if (!project || !draftRef.current) return null;
    return { ...project, ...draftRef.current };
  }, [project]);

  /** A render request saved the edits server-side; treat the draft as clean. */
  const markSubmitted = useCallback(() => setSaveState("saved"), []);

  return { draft, saveState, update, updateCaptions, updateMusic, saveNow, merged, markSubmitted, busy };
}

export type DraftApi = ReturnType<typeof useProjectDraft>;
