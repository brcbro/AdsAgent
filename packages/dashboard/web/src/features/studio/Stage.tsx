import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Download, FileText, History, Link2, MoveVertical, RectangleHorizontal, RectangleVertical, RotateCw, Square, UserRound, Wand2 } from "lucide-react";
import { api, videoUrl } from "@/lib/api";
import { cn, PROJECT_STATUS } from "@/lib/format";
import { copyText } from "@/lib/hooks";
import { usePresets } from "@/lib/queries";
import type { AspectRatio } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Badge, EmptyState, Segmented } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/tooltip";
import { useStudio } from "./studio-context";
import { VersionsDialog } from "./VersionsDialog";
import { VideoPlayer } from "./VideoPlayer";
import { RenderProgress } from "./RenderProgress";
import { ACTION_COPY } from "./useRenderActions";

export function Stage() {
  const { project, draft, adjustingCaptions, setAdjustingCaptions } = useStudio();
  const status = PROJECT_STATUS[project.status] ?? PROJECT_STATUS.draft;
  const aspect = draft.draft?.aspectRatio ?? "16:9";
  const done = project.status === "done";

  return (
    <section className="flex min-h-[520px] min-w-0 flex-1 flex-col bg-bg lg:min-h-0" aria-label="Preview">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-fg">{draft.draft?.title || project.id}</h1>
            <Badge tone={status.tone} dot pulse={draft.busy}>{status.label}</Badge>
          </div>
        </div>
        <Tip content="Video format for the next render">
          <span>
            <Segmented<AspectRatio>
              label="Video format"
              size="sm"
              value={aspect}
              disabled={draft.busy}
              onChange={(v) => draft.update({ aspectRatio: v })}
              options={[
                { value: "9:16", label: <><RectangleVertical /> 9:16</>, title: "Vertical — Reels, TikTok, Stories" },
                { value: "16:9", label: <><RectangleHorizontal /> 16:9</>, title: "Horizontal — feed and YouTube" },
              ]}
            />
          </span>
        </Tip>
        {done && (
          <Button
            size="sm"
            variant={adjustingCaptions ? "primary" : "secondary"}
            aria-pressed={adjustingCaptions}
            onClick={() => setAdjustingCaptions(!adjustingCaptions)}
          >
            <MoveVertical /> {adjustingCaptions ? "Done adjusting" : "Adjust captions"}
          </Button>
        )}
        <VersionsButton />
        <ExportMenu />
      </div>

      <div className="relative flex min-h-0 flex-1 p-3 sm:p-4">
        <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl bg-stage shadow-md ring-1 ring-black/5">
          <StageBody />
        </div>
      </div>
    </section>
  );
}

function StageBody() {
  const { project, actions, draft } = useStudio();
  const aspect = draft.draft?.aspectRatio ?? "16:9";

  if (draft.busy) return <RenderProgress />;
  if (project.status === "done") return <VideoPlayer />;

  if (project.status === "error") {
    return (
      <EmptyState
        dark
        className="m-auto"
        icon={<AlertTriangle className="text-red-400" />}
        title="The last render failed"
        description={<span className="line-clamp-4 font-mono text-xs">{project.error || "No error details were recorded."}</span>}
        action={
          <Button variant="primary" disabled={!!actions.reasons[actions.primary]} onClick={() => actions.run(actions.primary)}>
            <RotateCw /> Try again: {ACTION_COPY[actions.primary].short}
          </Button>
        }
      />
    );
  }

  const avatarImage = draft.draft?.avatar?.previewImageUrl;
  if (avatarImage) {
    return (
      <div className="m-auto flex h-full w-full flex-col items-center justify-center gap-4 p-6" style={{ containerType: "size" }}>
        <div
          className="overflow-hidden rounded-lg bg-black shadow-lg ring-1 ring-white/10"
          style={{ aspectRatio: aspect === "9:16" ? "9 / 16" : "16 / 9", height: aspect === "9:16" ? "min(78cqh, 640px)" : undefined, width: aspect === "16:9" ? "min(86cqw, 900px)" : undefined }}
        >
          <img src={avatarImage} alt={`${draft.draft?.avatar?.name ?? "Avatar"} preview`} className="size-full object-cover" />
        </div>
        <p className="text-sm text-white/60">
          {aspect === "9:16" ? "Vertical 9:16" : "Horizontal 16:9"} · {draft.draft?.avatar?.name} — ready for <span className="text-white">{ACTION_COPY[actions.primary].label}</span>
        </p>
      </div>
    );
  }

  return (
    <EmptyState
      dark
      className="m-auto"
      icon={<Wand2 />}
      title="Ready when you are"
      description="Write or paste your German script, choose captions and music, then create a local preview. Pick a HeyGen avatar if you want a presenter on screen."
      action={<>
        <Button variant="primary" disabled={!!actions.reasons.local} onClick={() => actions.run("local")}>{ACTION_COPY.local.label}</Button>
        <Button variant="on-dark" className="border border-white/15" onClick={() => document.getElementById("avatar-change")?.click()}><UserRound /> Choose avatar</Button>
      </>}
    />
  );
}

function VersionsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><History /> Versions</Button>
      <VersionsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ExportMenu() {
  const { project, draft, videoVersion } = useStudio();
  const presets = usePresets().data ?? [];
  const done = project.status === "done";

  async function download() {
    const preset = presets.find((p) => p.id === project.captions?.presetId);
    // Learning log only; the download itself must not depend on it.
    api.logDownload(project.id, {
      projectId: project.id,
      title: project.title,
      captionPreset: project.captions?.presetId,
      captionMode: preset?.mode,
      avatarId: project.avatar?.heygenAvatarId,
      avatarName: project.avatar?.name,
      scriptPreview: project.scriptDe?.slice(0, 200),
      playbackSpeed: project.outputSpeed ?? 1,
      bottomPercent: project.captions?.bottomPercent,
      fontSize: project.captions?.fontSize,
    }).catch(() => toast.warning("Download started, but it wasn't recorded in the learning log."));
    const a = document.createElement("a");
    a.href = videoUrl(project.id, videoVersion);
    a.download = `${draft.draft?.title || project.id}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex items-center">
      <Button size="sm" variant="secondary" className="rounded-r-none" disabled={!done} onClick={download}>
        <Download /> Download
      </Button>
      <Menu
        trigger={<Button size="sm" variant="secondary" className="-ml-px rounded-l-none px-2" aria-label="More export options" disabled={!done}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </Button>}
        items={[
          { label: "Download MP4", icon: <Download />, onSelect: download },
          { label: "Copy output path", icon: <FileText />, disabled: !project.outputFile, description: project.outputFile ? undefined : "Available after the next render",
            onSelect: async () => { if (await copyText(project.outputFile!)) toast.success("Output path copied"); } },
          { label: "Copy video link", icon: <Link2 />, onSelect: async () => { if (await copyText(new URL(videoUrl(project.id), location.origin).href)) toast.success("Video link copied"); } },
          { label: "Copy project ID", icon: <Copy />, onSelect: async () => { if (await copyText(project.id)) toast.success("Project ID copied"); } },
        ]}
      />
    </div>
  );
}

export function StopButton({ className }: { className?: string }) {
  const { actions } = useStudio();
  return (
    <Button size="sm" variant="on-dark" className={cn("border border-white/15", className)} loading={actions.running === "stop"} onClick={actions.stop}>
      <Square className="fill-current" /> Stop render
    </Button>
  );
}
