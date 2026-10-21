import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Check, History, Pause, Play, RotateCcw } from "lucide-react";
import { api, errorMessage, versionVideoUrl } from "@/lib/api";
import { cn, dateTime, relativeTime, timecode, wordCount } from "@/lib/format";
import { keys, useMusic, usePresets, useVersions } from "@/lib/queries";
import type { CaptionPreset, MusicTrack, Project, RenderVersion } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { Badge, EmptyState, Segmented, Skeleton } from "@/components/ui/primitives";
import { useStudio } from "./studio-context";
import { bumpVideoVersion } from "./useVideoVersion";

type Settings = RenderVersion["settings"];

/** Human-readable settings rows used for both the version list summary and the A/B diff. */
function describe(s: Settings, presets: CaptionPreset[], tracks: MusicTrack[]): Array<{ label: string; value: string }> {
  const preset = presets.find((p) => p.id === (s.captions?.presetId ?? "meta-clean"));
  const track = tracks.find((t) => t.file === s.music?.file);
  return [
    { label: "Format", value: s.aspectRatio ?? "16:9" },
    { label: "Caption style", value: preset?.name ?? s.captions?.presetId ?? "—" },
    { label: "Caption size", value: `${s.captions?.fontSize ?? preset?.fontSize ?? 32}px` },
    { label: "Caption position", value: `${s.captions?.bottomPercent ?? preset?.bottomPercent ?? 18}% from bottom` },
    { label: "Music", value: s.music?.enabled === false ? "Off" : track?.title ?? s.music?.title ?? "Default" },
    { label: "Music volume", value: s.music?.enabled === false ? "—" : `${Math.round((s.music?.volume ?? 0.25) * 100)}%` },
    { label: "Export speed", value: `${s.outputSpeed ?? 1}×` },
    { label: "B-roll", value: s.fullAvatar ? "Off" : `${(s.brollCutMs ?? 1800) / 1000}s clips` },
    { label: "Pinned / excluded clips", value: `${s.brollPinned?.length ?? 0} / ${s.brollExcluded?.length ?? 0}` },
    { label: "Presenter", value: s.avatar?.heygenAvatarId ? s.avatar.name ?? "HeyGen avatar" : s.avatar?.name || "None" },
    { label: "Script", value: `“${(s.scriptDe ?? "").split(/\s+/).slice(0, 6).join(" ")}…” · ${wordCount(s.scriptDe ?? "")} words` },
  ];
}

function sizeLabel(bytes: number) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

export function VersionsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { project } = useStudio();
  const versions = useVersions(project.id, open);
  const list = versions.data ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"list" | "compare">("list");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setMode("list"); setSelected([]); setPreviewId(null); }
  }, [open]);
  useEffect(() => { if (!previewId && list[0]) setPreviewId(list[0].id); }, [list, previewId]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  const pair = selected.map((id) => list.find((v) => v.id === id)).filter((v): v is RenderVersion => !!v);
  // Number versions from the oldest kept render so labels stay stable as new renders arrive.
  const label = (v: RenderVersion) => `Version ${list.length - list.indexOf(v)}`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={mode === "compare" ? "Compare versions" : "Version history"}
      description={mode === "compare"
        ? "Both videos play in sync. Settings that differ are highlighted."
        : `The last ${list.length || "few"} renders of this project are kept with the settings that produced them.`}
      headerExtra={list.length >= 2 ? (
        <Segmented
          label="View"
          size="sm"
          value={mode}
          onChange={(m) => { if (m === "compare" && pair.length < 2) setSelected(list.slice(0, 2).map((v) => v.id)); setMode(m); }}
          options={[{ value: "list", label: <><History /> History</> }, { value: "compare", label: <><ArrowLeftRight /> Compare</> }]}
        />
      ) : undefined}
    >
      {versions.isPending ? (
        <div className="grid gap-4 md:grid-cols-[1fr_340px]"><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /></div>
      ) : !list.length ? (
        <EmptyState
          icon={<History />}
          title="No saved versions yet"
          description="Every render from now on is kept here automatically — up to the last 10 — so you can compare and roll back."
        />
      ) : mode === "compare" && pair.length === 2 ? (
        <CompareView a={pair[0]} b={pair[1]} labelA={label(pair[0])} labelB={label(pair[1])} project={project} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_340px]">
          <div className="grid min-h-[360px] place-items-center overflow-hidden rounded-lg bg-stage">
            {previewId && <video key={previewId} src={versionVideoUrl(project.id, previewId)} controls playsInline className="max-h-[60vh] w-full" />}
          </div>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" aria-label="Versions">
            {list.map((v, i) => (
              <VersionRow
                key={v.id}
                version={v}
                label={label(v)}
                latest={i === 0}
                previewing={previewId === v.id}
                checked={selected.includes(v.id)}
                onPreview={() => setPreviewId(v.id)}
                onToggle={() => toggle(v.id)}
                onRestored={() => onOpenChange(false)}
              />
            ))}
            {selected.length === 2 && (
              <li className="sticky bottom-0 bg-surface pt-1">
                <Button variant="primary" className="w-full" onClick={() => setMode("compare")}><ArrowLeftRight /> Compare selected</Button>
              </li>
            )}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function VersionRow({ version, label, latest, previewing, checked, onPreview, onToggle, onRestored }: {
  version: RenderVersion; label: string; latest: boolean; previewing: boolean; checked: boolean;
  onPreview: () => void; onToggle: () => void; onRestored: () => void;
}) {
  const { project, draft } = useStudio();
  const client = useQueryClient();
  const confirm = useConfirm();
  const presets = usePresets().data ?? [];
  const [restoring, setRestoring] = useState(false);
  const preset = presets.find((p) => p.id === version.settings.captions?.presetId);

  async function restore() {
    const scriptChanged = (version.settings.scriptDe ?? "") !== (draft.draft?.scriptDe ?? "");
    const ok = await confirm({
      title: `Restore ${label}?`,
      confirmLabel: "Restore version",
      description: (
        <>
          <p>This version becomes the current video, and its caption, music, B-roll and export settings come back.</p>
          {scriptChanged && (
            <p className="mt-2 rounded-md bg-warning-subtle p-2.5 text-warning">
              It used a different script. The script and presenter are not restored, because Apply edits reuses the latest narration.
            </p>
          )}
        </>
      ),
    });
    if (!ok) return;
    setRestoring(true);
    try {
      await draft.saveNow();
      const result = await api.restoreVersion(project.id, version.id);
      client.setQueryData(keys.project(project.id), result.project);
      client.setQueryData<Project[]>(keys.projects, (list) => list?.map((p) => (p.id === project.id ? result.project : p)));
      bumpVideoVersion(project.id);
      toast.success(`${label} restored`);
      onRestored();
    } catch (err) {
      toast.error("Couldn't restore this version", { description: errorMessage(err) });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <li className={cn("rounded-lg border bg-surface p-3 transition-colors", previewing ? "border-accent bg-accent-subtle/40" : "border-line")}>
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${label} to compare`}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <button type="button" onClick={onPreview} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{label}</span>
            {latest && <Badge tone="success">Latest</Badge>}
            {previewing && <Badge tone="accent"><Play className="size-3" /> Playing</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-fg-muted" title={dateTime(version.createdAt)}>
            {relativeTime(version.createdAt)} · {sizeLabel(version.sizeBytes)} · {version.settings.aspectRatio ?? "16:9"}
          </div>
          <div className="mt-1 truncate text-xs text-fg-secondary">
            {preset?.name ?? "Captions"} · {version.settings.music?.enabled === false ? "no music" : `music ${Math.round((version.settings.music?.volume ?? 0.25) * 100)}%`} · {version.settings.outputSpeed ?? 1}×
          </div>
        </button>
      </div>
      {!latest && (
        <Button size="sm" variant="secondary" className="mt-2.5 w-full" loading={restoring} disabled={draft.busy} onClick={restore}>
          <RotateCcw /> Restore this version
        </Button>
      )}
    </li>
  );
}

function CompareView({ a, b, labelA, labelB, project }: { a: RenderVersion; b: RenderVersion; labelA: string; labelB: string; project: Project }) {
  const presets = usePresets().data ?? [];
  const tracks = useMusic().data ?? [];
  const va = useRef<HTMLVideoElement>(null);
  const vb = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audio, setAudio] = useState<"a" | "b">("a");

  useEffect(() => {
    if (va.current) va.current.muted = audio !== "a";
    if (vb.current) vb.current.muted = audio !== "b";
  }, [audio]);

  const both = (fn: (v: HTMLVideoElement) => void) => [va.current, vb.current].forEach((v) => v && fn(v));
  const toggle = () => {
    if (playing) both((v) => v.pause());
    else both((v) => void v.play());
    setPlaying(!playing);
  };
  const seek = (t: number) => both((v) => { v.currentTime = Math.min(t, v.duration || t); });

  const rowsA = useMemo(() => describe(a.settings, presets, tracks), [a, presets, tracks]);
  const rowsB = useMemo(() => describe(b.settings, presets, tracks), [b, presets, tracks]);
  const changed = rowsA.filter((r, i) => r.value !== rowsB[i].value).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {([[a, labelA, va], [b, labelB, vb]] as const).map(([v, l, ref], i) => (
          <figure key={v.id} className="overflow-hidden rounded-lg bg-stage">
            <video
              ref={ref}
              src={versionVideoUrl(project.id, v.id)}
              playsInline
              preload="auto"
              muted={i === 0 ? audio !== "a" : audio !== "b"}
              onLoadedMetadata={(e) => {
                // Read now: React clears currentTarget before a deferred state updater runs.
                const length = e.currentTarget.duration;
                setDuration((d) => Math.max(d, length));
              }}
              onTimeUpdate={(e) => {
                if (i !== 0) return;
                setTime(e.currentTarget.currentTime);
                // Keep B within a frame or two of A.
                const other = vb.current;
                if (other && Math.abs(other.currentTime - e.currentTarget.currentTime) > 0.15) other.currentTime = e.currentTarget.currentTime;
              }}
              onEnded={() => setPlaying(false)}
              className="max-h-[46vh] w-full"
            />
            <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-white/80">
              <span className="font-semibold text-white">{l}</span>
              <span>{relativeTime(v.createdAt)}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <Button size="icon-sm" variant="primary" aria-label={playing ? "Pause both" : "Play both"} onClick={toggle}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>
        <span className="tabular text-xs text-fg-muted">{timecode(time)} / {timecode(duration)}</span>
        <input
          type="range"
          className="range min-w-40 flex-1"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          onChange={(e) => { const t = Number(e.target.value); setTime(t); seek(t); }}
          style={{ ["--fill" as string]: `${duration ? (time / duration) * 100 : 0}%` }}
          aria-label="Seek both videos"
        />
        <Segmented label="Audio from" size="sm" value={audio} onChange={setAudio}
          options={[{ value: "a", label: `Audio: ${labelA}` }, { value: "b", label: `Audio: ${labelB}` }]} />
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between border-b border-line bg-bg px-3 py-2">
          <h3 className="text-sm font-semibold text-fg">Settings</h3>
          <Badge tone={changed ? "warning" : "neutral"}>{changed ? `${changed} difference${changed === 1 ? "" : "s"}` : "Identical settings"}</Badge>
        </div>
        <table className="w-full text-sm">
          <thead className="sr-only"><tr><th>Setting</th><th>{labelA}</th><th>{labelB}</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rowsA.map((row, i) => {
              const diff = row.value !== rowsB[i].value;
              return (
                <tr key={row.label} className={diff ? "bg-warning-subtle/50" : undefined}>
                  <th scope="row" className="w-1/4 px-3 py-2 text-left text-xs font-medium text-fg-muted">{row.label}</th>
                  <td className={cn("px-3 py-2 text-fg", diff && "font-medium")}>{row.value}</td>
                  <td className={cn("px-3 py-2 text-fg", diff && "font-medium")}>
                    <span className="inline-flex items-center gap-1.5">{rowsB[i].value}{!diff && <Check className="size-3.5 text-fg-muted" aria-label="same" />}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
