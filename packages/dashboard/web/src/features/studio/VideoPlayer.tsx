import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Gauge, Maximize, Minimize, Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import { videoUrl } from "@/lib/api";
import { cn, timecode } from "@/lib/format";
import { useHotkeys } from "@/lib/hooks";
import { usePresets } from "@/lib/queries";
import { IconButton } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useStudio } from "./studio-context";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FRAME = 1 / 30;

export function VideoPlayer() {
  const { project, videoVersion, adjustingCaptions } = useStudio();
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ratio, setRatio] = useState(project.aspectRatio === "9:16" ? 9 / 16 : 16 / 9);
  const [failed, setFailed] = useState(false);
  const src = videoUrl(project.id, videoVersion);

  useEffect(() => { setFailed(false); }, [src]);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const v = () => video.current;
  const toggle = () => { const el = v(); if (!el) return; if (el.paused) void el.play(); else el.pause(); };
  const seek = (t: number) => { const el = v(); if (el) el.currentTime = Math.min(Math.max(0, t), el.duration || 0); };
  const step = (frames: number) => { const el = v(); if (!el) return; el.pause(); seek(el.currentTime + frames * FRAME); };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  };

  useHotkeys({
    space: toggle,
    k: toggle,
    j: () => seek((v()?.currentTime ?? 0) - 5),
    l: () => seek((v()?.currentTime ?? 0) + 5),
    ",": () => step(-1),
    ".": () => step(1),
    m: () => setMuted((m) => !m),
    f: toggleFullscreen,
  }, !adjustingCaptions);

  useEffect(() => { if (v()) v()!.playbackRate = rate; }, [rate]);
  useEffect(() => { if (v()) { v()!.muted = muted; v()!.volume = volume; } }, [muted, volume]);

  const fill = duration ? (time / duration) * 100 : 0;

  return (
    <div ref={frame} className="flex min-h-0 flex-1 flex-col bg-stage">
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" style={{ containerType: "size" }}>
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: ratio, width: `min(100cqw, calc(100cqh * ${ratio}))` }}>
          {failed ? (
            <div className="grid size-full place-items-center rounded-lg bg-stage-raised p-6 text-center text-sm text-white/60">
              The video file couldn't be loaded. It may have been moved — try Apply edits to render it again.
            </div>
          ) : (
            <video
              ref={video}
              src={src}
              playsInline
              preload="metadata"
              loop={loop}
              onClick={adjustingCaptions ? undefined : toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                setDuration(el.duration);
                if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight);
                el.playbackRate = rate;
              }}
              onError={() => setFailed(true)}
              className="size-full cursor-pointer rounded-lg bg-black object-contain shadow-lg"
              aria-label={`${project.title} video`}
            />
          )}
          {adjustingCaptions && <CaptionPositionOverlay ratio={ratio} />}
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-white/10 bg-stage-raised px-2 py-1.5 text-white sm:gap-2 sm:px-3">
        <IconButton label={playing ? "Pause (Space)" : "Play (Space)"} variant="on-dark" size="icon-sm" onClick={toggle} disabled={failed}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </IconButton>
        <span className="tabular w-[84px] shrink-0 text-center text-xs text-white/75">{timecode(time)} / {timecode(duration)}</span>
        <input
          type="range"
          className="range on-dark min-w-0 flex-1"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          disabled={failed || !duration}
          onChange={(e) => seek(Number(e.target.value))}
          style={{ ["--fill" as string]: `${fill}%` }}
          aria-label="Seek"
          aria-valuetext={`${timecode(time)} of ${timecode(duration)}`}
        />
        <IconButton label={muted ? "Unmute (M)" : "Mute (M)"} variant="on-dark" size="icon-sm" onClick={() => setMuted(!muted)}>
          {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
        </IconButton>
        <input
          type="range"
          className="range on-dark hidden w-20 sm:block"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }}
          style={{ ["--fill" as string]: `${(muted ? 0 : volume) * 100}%` }}
          aria-label="Volume"
        />
        <Menu
          trigger={
            <button type="button" aria-label={`Preview speed ${rate}×`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-white/85 hover:bg-white/10">
              <Gauge className="size-4" /> <span className="tabular">{rate}×</span>
            </button>
          }
          items={[
            ...SPEEDS.map((s) => ({ label: `${s}×${s === 1 ? " (normal)" : ""}`, onSelect: () => setRate(s), icon: <span className={cn("size-1.5 rounded-full", s === rate ? "bg-accent" : "bg-transparent")} /> })),
            { label: "Preview only", description: "Export speed is set in the Settings tab", disabled: true, separatorBefore: true },
          ]}
        />
        <IconButton label={loop ? "Loop on" : "Loop off"} variant="on-dark" size="icon-sm" aria-pressed={loop} onClick={() => setLoop(!loop)}
          className={loop ? "bg-white/15 text-white" : undefined}>
          <Repeat />
        </IconButton>
        <IconButton label={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"} variant="on-dark" size="icon-sm" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize /> : <Maximize />}
        </IconButton>
      </div>
    </div>
  );
}

const SNAPS = [10, 15, 18, 20, 25, 30, 35, 50];

/*
 * Drag (mouse, touch or pen) or use the arrow keys to place the caption baseline. The value is
 * saved with the project; Apply edits bakes it into the video.
 */
function CaptionPositionOverlay({ ratio }: { ratio: number }) {
  const { draft } = useStudio();
  const presets = usePresets().data ?? [];
  const area = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const preset = presets.find((p) => p.id === (draft.draft?.captions?.presetId ?? "meta-clean")) ?? presets[0];
  const pct = draft.draft?.captions?.bottomPercent ?? preset?.bottomPercent ?? 18;
  const vertical = ratio < 1;

  const setPct = (value: number, snap: boolean) => {
    let next = Math.round(Math.min(85, Math.max(5, value)));
    if (snap) {
      const near = SNAPS.find((s) => Math.abs(s - value) <= 1.5);
      if (near !== undefined) next = near;
    }
    draft.updateCaptions({ bottomPercent: next });
  };

  const fromPointer = (e: ReactPointerEvent) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    setPct((1 - (e.clientY - rect.top) / rect.height) * 100, !e.altKey);
  };

  return (
    <div ref={area} className="absolute inset-0 overflow-hidden rounded-lg bg-black/25 animate-fade-in"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging(true); fromPointer(e); }}
      onPointerMove={(e) => { if (dragging) fromPointer(e); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      style={{ touchAction: "none", cursor: "row-resize" }}
    >
      {vertical && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[14%] border-b border-dashed border-white/40 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.07)_0_6px,transparent_6px_12px)]">
            <span className="absolute bottom-1 left-2 text-[11px] font-medium text-white/70">Top UI · keep clear (14%)</span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[35%] border-t border-dashed border-white/30 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.05)_0_6px,transparent_6px_12px)]">
            <span className="absolute top-1 left-2 text-[11px] font-medium text-white/60">Reels UI may overlap (Meta guidance: bottom 35%)</span>
          </div>
        </>
      )}
      {SNAPS.map((s) => (
        <div key={s} className="pointer-events-none absolute right-0 h-px w-2 bg-white/40" style={{ bottom: `${s}%` }} aria-hidden />
      ))}
      <div className="absolute inset-x-3 flex translate-y-1/2 items-center" style={{ bottom: `${pct}%` }}>
        <div className="h-0.5 flex-1 rounded bg-accent shadow-[0_0_0_1px_rgb(255_255_255/0.4)]" />
        <div
          role="slider"
          tabIndex={0}
          autoFocus
          aria-label="Caption position from bottom"
          aria-valuemin={5}
          aria-valuemax={85}
          aria-valuenow={pct}
          aria-valuetext={`${pct}% from bottom`}
          onKeyDown={(e) => {
            const delta = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
            if (!delta) return;
            e.preventDefault();
            setPct(pct + delta * (e.shiftKey ? 5 : 1), false);
          }}
          className="mx-2 flex shrink-0 cursor-row-resize items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg shadow-lg ring-2 ring-white/40 focus-visible:ring-white"
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m7 9 5-5 5 5M7 15l5 5 5-5" /></svg>
          Captions · {pct}%
        </div>
        <div className="h-0.5 flex-1 rounded bg-accent shadow-[0_0_0_1px_rgb(255_255_255/0.4)]" />
      </div>
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white/85 whitespace-nowrap">
        Drag or use ↑ ↓ · hold Alt to skip snapping · then Apply edits
      </div>
    </div>
  );
}
