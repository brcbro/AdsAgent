import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { getPrefs } from "@/lib/prefs";
import { keys, useBroll, useRenderStatus, useStudioConfig } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { useConfirm } from "@/components/ui/dialog";
import type { DraftApi } from "./useProjectDraft";

export type RenderAction = "avatar" | "apply";

export const ACTION_COPY: Record<RenderAction, { label: string; short: string; description: string }> = {
  avatar: {
    label: "Create avatar video",
    short: "Avatar video",
    description: "HeyGen presenter speaks the script in its own voice (ElevenLabs V4); B-roll follows the hook. Usually 2–5 min.",
  },
  apply: {
    label: "Apply edits",
    short: "Apply edits",
    description: "Re-render captions, music and B-roll using the saved voice and footage. No API credits.",
  },
};

/*
 * The two render paths, why each is unavailable, which one is the sensible default, and the
 * spend confirmation that runs before anything that uses paid API credits.
 */
export function useRenderActions(project: Project | undefined, draft: DraftApi) {
  const client = useQueryClient();
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
    avatar: !project ? "Select a project"
      : draft.busy ? "This project is rendering"
      : otherRender ? "Another video is rendering — wait for it to finish"
      : !hasAvatar ? "Choose a HeyGen avatar first"
      : !hasScript ? "Write a German script first"
      : !d?.fullAvatar && !broll.length ? "Add B-roll clips to the library first"
      : services && !services.avatar ? "HeyGen isn't configured — see Settings"
      : null,
    apply: !project ? "Select a project"
      : draft.busy ? "This project is rendering"
      : otherRender ? "Another video is rendering — wait for it to finish"
      : !project.hasSourceClip ? "Create an avatar video first — Apply edits reuses its voice and footage"
      : null,
  };

  const primary: RenderAction = project?.hasSourceClip ? "apply" : "avatar";

  async function confirmSpend(action: RenderAction): Promise<boolean> {
    const prefs = getPrefs();
    if (action === "apply" || !prefs.confirmSpend) return true;
    return confirm({
      title: "Create avatar video?",
      confirmLabel: "Create avatar video",
      description: (
        <>HeyGen generates the presenter and the audio, speaking your script in <strong className="font-semibold text-fg">{d?.avatar?.voiceName ? `the voice ${d.avatar.voiceName}` : "the avatar's own voice"}</strong> with ElevenLabs V4. <strong className="font-semibold text-fg">This uses paid HeyGen credits.</strong> Rendering usually takes 2–5 minutes.</>
      ),
    });
  }

  async function run(action: RenderAction) {
    if (!project || reasons[action]) return;
    const meta = draft.merged();
    if (!meta) return;
    if (!(await confirmSpend(action))) return;
    setRunning(action);
    try {
      await (action === "avatar" ? api.sendAvatar(project.id, meta) : api.applyEdits(project.id, meta));
      draft.markSubmitted();
      client.setQueryData<Project>(keys.project(project.id), (p) => (p ? { ...p, ...draft.draft, status: action === "avatar" ? "generating" : "rendering" } : p));
      toast.success(action === "avatar" ? "Avatar video started" : "Applying edits", {
        description: action === "avatar" ? "Usually takes 2–5 minutes. You can keep working on other projects." : "Reusing the saved voice and footage.",
      });
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
      description: "Any saved avatar clip and finished video stay available. HeyGen requests already submitted can still complete and incur charges.",
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
