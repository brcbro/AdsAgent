import { useRef, useState } from "react";
import { Tabs } from "radix-ui";
import { AudioLines, Captions, ChevronDown, Film, Lock, Play, ScrollText, SlidersHorizontal, UserRound, Wand2 } from "lucide-react";
import { cn } from "@/lib/format";
import { usePref } from "@/lib/prefs";
import { useMediaQuery } from "@/lib/hooks";
import { Button, DisabledReason } from "@/components/ui/button";
import { Badge, Spinner } from "@/components/ui/primitives";
import { Menu } from "@/components/ui/menu";
import { useStudio } from "./studio-context";
import { ACTION_COPY, type RenderAction } from "./useRenderActions";
import { AvatarPickerDialog } from "./AvatarPickerDialog";
import { ScriptPanel } from "./panels/ScriptPanel";
import { AudioPanel } from "./panels/AudioPanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { BrollPanel } from "./panels/BrollPanel";
import { SettingsPanel } from "./panels/SettingsPanel";

const TABS = [
  { id: "script", label: "Script", icon: ScrollText, Panel: ScriptPanel },
  { id: "audio", label: "Audio", icon: AudioLines, Panel: AudioPanel },
  { id: "captions", label: "Captions", icon: Captions, Panel: CaptionsPanel },
  { id: "broll", label: "B-roll", icon: Film, Panel: BrollPanel },
  { id: "settings", label: "Settings", icon: SlidersHorizontal, Panel: SettingsPanel },
];

const MIN_W = 340;
const MAX_W = 560;

export function Inspector() {
  const { draft, inspectorTab, setInspectorTab } = useStudio();
  const [width, setWidth] = usePref("inspectorWidth");
  const wide = useMediaQuery("(min-width: 1024px)");
  const dragStart = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));

  return (
    <aside
      className="@container relative flex shrink-0 flex-col border-line bg-surface lg:min-h-0 lg:border-l"
      style={wide ? { width: clamp(width) } : undefined}
      aria-label="Video settings"
    >
      {wide && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize settings panel"
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          aria-valuenow={clamp(width)}
          tabIndex={0}
          className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize focus-visible:outline-none"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragStart.current = { x: e.clientX, w: clamp(width) }; }}
          onPointerMove={(e) => { if (dragStart.current) setWidth(clamp(dragStart.current.w + dragStart.current.x - e.clientX)); }}
          onPointerUp={() => { dragStart.current = null; }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth(clamp(width + 20));
            if (e.key === "ArrowRight") setWidth(clamp(width - 20));
          }}
        >
          <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/50 group-focus-visible:bg-accent" />
        </div>
      )}

      <AvatarCard />

      <Tabs.Root value={inspectorTab} onValueChange={setInspectorTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label="Settings sections" className="flex shrink-0 overflow-x-auto border-b border-line px-1.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <Tabs.Trigger
              key={id}
              value={id}
              className={cn(
                "relative inline-flex h-10 flex-1 items-center justify-center gap-1.5 px-2 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg",
                "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
                "data-[state=active]:text-fg data-[state=active]:after:bg-accent",
              )}
            >
              <Icon className="hidden size-4 @[440px]:block" aria-hidden />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {draft.busy && (
          <div className="flex items-center gap-2 border-b border-line bg-accent-subtle px-4 py-2 text-xs text-accent">
            <Lock className="size-3.5" aria-hidden /> Editing is locked while this video renders.
          </div>
        )}
        {TABS.map(({ id, Panel }) => (
          <Tabs.Content key={id} value={id} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none lg:min-h-0">
            <fieldset disabled={draft.busy} className="min-w-0 disabled:opacity-70">
              <Panel />
            </fieldset>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <ActionBar />
    </aside>
  );
}

function AvatarCard() {
  const { draft } = useStudio();
  const [open, setOpen] = useState(false);
  const avatar = draft.draft?.avatar;
  const isHeygen = !!avatar?.heygenAvatarId;
  const isLocal = !isHeygen && avatar?.name === "Local waveform preview";

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line p-3">
      <div className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-subtle text-fg-muted">
        {avatar?.previewImageUrl
          ? <img src={avatar.previewImageUrl} alt="" className="size-full object-cover" />
          : isLocal ? <AudioLines className="size-4" /> : <UserRound className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg">{isHeygen ? avatar?.name || "HeyGen avatar" : isLocal ? "Waveform intro" : "No presenter"}</div>
        <div className="mt-1">
          {isHeygen ? <Badge tone="accent">HeyGen avatar</Badge> : isLocal ? <Badge tone="info">Local preview</Badge> : <Badge>Voice + B-roll only</Badge>}
        </div>
      </div>
      <Button id="avatar-change" size="sm" variant="secondary" disabled={draft.busy} onClick={() => setOpen(true)}>
        {isHeygen ? "Change" : "Choose avatar"}
      </Button>
      <AvatarPickerDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ActionBar() {
  const { actions, draft } = useStudio();
  const primary = actions.primary;
  const order: RenderAction[] = ["local", "avatar", "apply"];

  return (
    <div className="shrink-0 space-y-2.5 border-t border-line bg-surface p-3 shadow-[0_-4px_12px_rgb(9_9_11/0.03)]">
      <SaveIndicator />
      <div className="flex">
        <div className="flex min-w-0 flex-1 [&>*]:w-full">
        <DisabledReason reason={actions.reasons[primary]}>
          <Button
            variant="primary"
            size="lg"
            className="w-full min-w-0 shrink rounded-r-none"
            disabled={!!actions.reasons[primary]}
            loading={actions.running === primary}
            onClick={() => actions.run(primary)}
          >
            {primary === "apply" ? <Wand2 /> : <Play className="fill-current" />}
            <span className="truncate">{ACTION_COPY[primary].label}</span>
          </Button>
        </DisabledReason>
        </div>
        <Menu
          className="w-80"
          trigger={
            <Button variant="primary" size="lg" className="rounded-l-none border-l border-white/25 px-2.5" aria-label="More render options" disabled={draft.busy}>
              <ChevronDown />
            </Button>
          }
          items={order.map((a) => ({
            label: ACTION_COPY[a].label + (a === primary ? " · default" : ""),
            description: actions.reasons[a] ?? ACTION_COPY[a].description,
            icon: a === "apply" ? <Wand2 /> : <Play />,
            disabled: !!actions.reasons[a],
            onSelect: () => actions.run(a),
          }))}
        />
      </div>
      <p className="text-xs leading-relaxed text-fg-muted">{ACTION_COPY[primary].description}</p>
    </div>
  );
}

function SaveIndicator() {
  const { draft } = useStudio();
  const state = draft.saveState;
  return (
    <div className="flex h-5 items-center justify-between text-xs" aria-live="polite">
      {state === "saving" ? (
        <span className="flex items-center gap-1.5 text-fg-muted"><Spinner className="size-3" /> Saving…</span>
      ) : state === "dirty" ? (
        <span className="flex items-center gap-1.5 text-warning"><span className="size-1.5 rounded-full bg-warning" /> Unsaved changes</span>
      ) : state === "error" ? (
        <span className="flex items-center gap-1.5 text-danger"><span className="size-1.5 rounded-full bg-danger" /> Couldn't save</span>
      ) : (
        <span className="flex items-center gap-1.5 text-fg-muted"><span className="size-1.5 rounded-full bg-success" /> All changes saved</span>
      )}
      {(state === "dirty" || state === "error") && !draft.busy && (
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => void draft.saveNow()}>
          {state === "error" ? "Retry" : "Save now"}
        </button>
      )}
    </div>
  );
}
