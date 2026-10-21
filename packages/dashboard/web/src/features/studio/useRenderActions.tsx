import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { getPrefs, setPrefs } from "@/lib/prefs";
import { keys, useBroll, useRenderStatus, useStudioConfig } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { useConfirm } from "@/components/ui/dialog";
import type { DraftApi } from "./useProjectDraft";

export type RenderAction = "local" | "avatar" | "apply";

export const ACTION_COPY: Record<RenderAction, { label: string; short: string; description: string }> = {
  local: {
    label: "Create local preview",
    short: "Local preview",
    description: "German ElevenLabs voice, waveform intro and matched B-roll. No HeyGen. Creates a separate project.",
  },
  avatar: {
    label: "Create avatar video",
    short: "Avatar video",
    description: "HeyGen talking avatar driven by ElevenLabs narration, plus B-roll, captions and music. Usually 2–5 min.",
  },
  apply: {
    label: "Apply edits",
    short: "Apply edits",
    description: "Re-render captions, music and B-roll using the saved voice and footage. No API credits.",
  },
};

/*
 * The three render paths, why each is unavailable, which one is the sensible default, and the
 * spend confirmation that runs before anything that uses paid API credits.
 */
export function useRenderActions(project: Project | undefined, draft: DraftApi) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const broll = useBroll().data ?? [];
  const services = useStudioConfig().data?.services;
  const renderStatus = useRenderStatus().data;
  const [running, setRunning] = useState<RenderAction | "stop" | null>(null);

  const d = draft.draft;
  const otherRender = !!renderStatus?.rendering && renderStatus.projectId !== project?.id;
  const hasScript = !!d?.scriptDe?.trim();
  const hasAvatar = !!d?.avatar?.heygenAvatarId;

  const reasons: Record<RenderAction, string | null> = {
    local: !project ? "Select a project"
      : draft.busy ? "This project is rendering"
      : otherRender ? "Another video is rendering — wait for it to finish"
      : !hasScript ? "Write a German script first"
      : !broll.length ? "Add B-roll clips to the library first"
      : services && !services.voice ? "ElevenLabs isn't configured — see Settings"
      : null,
    avatar: !project ? "Select a project"
      : draft.busy ? "This project is rendering"
      : otherRender ? "Another video is rendering — wait for it to finish"
      : !hasAvatar ? "Choose a HeyGen avatar first"
      : !hasScript ? "Write a German script first"
      : services && !services.avatar ? "HeyGen isn't configured — see Settings"
      : services && !services.voice ? "ElevenLabs isn't configured — see Settings"
      : null,
    apply: !project ? "Select a project"
      : draft.busy ? "This project is rendering"
      : otherRender ? "Another video is rendering — wait for it to finish"
      : project.status !== "done" ? "Render a video first — Apply edits reuses its voice and footage"
      : null,
  };

  const primary: RenderAction = project?.status === "done" ? "apply" : hasAvatar ? "avatar" : "local";

  async function confirmSpend(action: RenderAction): Promise<boolean> {
    const prefs = getPrefs();
    if (action === "apply" || !prefs.confirmSpend) return true;
    if (action === "local" && prefs.skipLocalPreviewConfirm) return true;
    let dontAsk = false;
    return confirm({
      title: action === "avatar" ? "Create avatar video?" : "Create local preview?",
      confirmLabel: action === "avatar" ? "Create avatar video" : "Create preview",
      description: action === "avatar" ? (
        <>This generates new ElevenLabs narration and a HeyGen avatar clip. <strong className="font-semibold text-fg">Both use paid API credits.</strong> Rendering usually takes 2–5 minutes.</>
      ) : (
        <>This creates a separate preview project with German narration, B-roll, captions and music. Saved narration is reused when the script, voice and model match; <strong className="font-semibold text-fg">new text uses ElevenLabs credits.</strong></>
      ),
      body: action === "local" ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" onChange={(e) => { dontAsk = e.target.checked; }} />
          Don't ask again for local previews
        </label>
      ) : undefined,
    }).then((ok) => {
      if (ok && dontAsk) setPrefs({ skipLocalPreviewConfirm: true });
      return ok;
    });
  }

  async function run(action: RenderAction) {
    if (!project || reasons[action]) return;
    const meta = draft.merged();
    if (!meta) return;
    if (!(await confirmSpend(action))) return;
    setRunning(action);
    try {
      if (action === "local") {
        // The preview is a new project, so keep the source project's edits saved too.
        await draft.saveNow();
        const result = await api.localPreview(project.id, meta);
        client.setQueryData(keys.project(result.project.id), result.project);
        client.setQueryData<Project[]>(keys.projects, (list) => [result.project, ...(list ?? [])]);
        toast.success("Local preview started", { description: "A new preview project is rendering. Your original project is unchanged." });
        navigate(`/studio/${result.project.id}`);
      } else {
        await (action === "avatar" ? api.sendAvatar(project.id, meta) : api.applyEdits(project.id, meta));
        draft.markSubmitted();
        client.setQueryData<Project>(keys.project(project.id), (p) => (p ? { ...p, ...draft.draft, status: action === "avatar" ? "generating" : "rendering" } : p));
        toast.success(action === "avatar" ? "Avatar video started" : "Applying edits", {
          description: action === "avatar" ? "Usually takes 2–5 minutes. You can keep working on other projects." : "Reusing the saved voice and footage.",
        });
      }
      void client.invalidateQueries({ queryKey: keys.renderStatus });
      void client.invalidateQueries({ queryKey: keys.projects });
    } catch (err) {
      toast.error(`Couldn't start: ${ACTION_COPY[action].short.toLowerCase()}`, { description: errorMessage(err) });
    } finally {
      setRunning(null);
    }
  }

  async function stop() {
    if (!project) return;
    const ok = await confirm({
      title: "Stop this render?",
      description: "The current render is cancelled and the project returns to draft. API calls already made are still billed.",
      confirmLabel: "Stop render",
      tone: "danger",
    });
    if (!ok) return;
    setRunning("stop");
    try {
      await api.cancelRender(project.id);
      toast.success("Render stopped");
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.project(project.id) }),
        client.invalidateQueries({ queryKey: keys.renderStatus }),
        client.invalidateQueries({ queryKey: keys.projects }),
      ]);
    } catch (err) {
      toast.error("Couldn't stop the render", { description: errorMessage(err) });
    } finally {
      setRunning(null);
    }
  }

  return { reasons, primary, run, stop, running };
}

export type RenderActions = ReturnType<typeof useRenderActions>;
