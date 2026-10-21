import { createContext, useContext } from "react";
import type { Project } from "@/lib/types";
import type { DraftApi } from "./useProjectDraft";
import type { RenderActions } from "./useRenderActions";

export interface StudioState {
  project: Project;
  draft: DraftApi;
  actions: RenderActions;
  videoVersion?: string;
  adjustingCaptions: boolean;
  setAdjustingCaptions: (on: boolean) => void;
  inspectorTab: string;
  setInspectorTab: (tab: string) => void;
}

export const StudioContext = createContext<StudioState | null>(null);

export function useStudio(): StudioState {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside the Studio page");
  return ctx;
}
