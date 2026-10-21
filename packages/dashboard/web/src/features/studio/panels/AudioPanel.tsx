import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Check, Pause, Play } from "lucide-react";
import { cn } from "@/lib/format";
import { useInView } from "@/lib/hooks";
import { useMusic, useStudioConfig } from "@/lib/queries";
import { useWaveform } from "@/lib/waveform";
import type { MusicTrack } from "@/lib/types";
import { Badge, Hint, KeyValue, RangeField, Section, Skeleton, SwitchRow } from "@/components/ui/primitives";
import { useStudio } from "../studio-context";

function trackUrl(track: MusicTrack) {
  return track.previewUrl || `/${track.file.replace(/^\/?/, "")}`;
}

/** One shared preview player: starting a track stops the previous one; leaving the panel stops it. */
export function useTrackPreview(volume = 0.6) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, []);
  useEffect(() => { if (audio.current) audio.current.volume = Math.min(1, Math.max(0, volume)); }, [volume]);

  const toggle = (track: MusicTrack, onError?: () => void) => {
    if (playing === track.file) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(trackUrl(track));
    a.volume = Math.min(1, Math.max(0, volume));
    a.onended = () => { setPlaying(null); setProgress(0); };
    a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    audio.current = a;
    setPlaying(track.file);
    setProgress(0);
    a.play().catch(() => { setPlaying(null); onError?.(); });
  };

  const seek = (fraction: number) => {
    const a = audio.current;
    if (a?.duration) a.currentTime = fraction * a.duration;
  };

  return { playing, progress, toggle, seek };
}

/** Bars of the track's real loudness; the played part is drawn in the accent colour. Click to seek while playing. */
function Waveform({ peaks, progress, onSeek, label }: { peaks: number[] | null; progress: number; onSeek?: (f: number) => void; label: string }) {
  if (!peaks) return <div className="h-6 rounded bg-subtle animate-pulse-soft" aria-hidden />;
  const played = Math.round(progress * peaks.length);
  return (
    <svg
      viewBox={`0 0 ${peaks.length * 3} 24`}
      preserveAspectRatio="none"
      className={cn("h-6 w-full", onSeek && "cursor-pointer")}
      role={onSeek ? "slider" : "img"}
      aria-label={onSeek ? `Seek ${label}` : `${label} waveform`}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={onSeek ? Math.round(progress * 100) : undefined}
      tabIndex={onSeek ? 0 : undefined}
      onClick={onSeek ? (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      } : undefined}
      onKeyDown={onSeek ? (e) => {
        if (e.key === "ArrowRight") onSeek(Math.min(1, progress + 0.05));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, progress - 0.05));
      } : undefined}
    >
      {peaks.map((p, i) => {
        const h = Math.max(2, p * 22);
        return <rect key={i} x={i * 3} y={(24 - h) / 2} width={2} height={h} rx={1} className={i < played ? "fill-accent" : "fill-line-strong"} />;
      })}
    </svg>
  );
}

export function TrackRow({ track, selected, playing, progress = 0, onSeek, onSelect, onTogglePlay, disabled }: {
  track: MusicTrack; selected?: boolean; playing: boolean; progress?: number; onSeek?: (f: number) => void;
  onSelect?: () => void; onTogglePlay: () => void; disabled?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const peaks = useWaveform(track.available ? trackUrl(track) : undefined, inView);
  return (
    <div ref={ref} className={cn(
      "flex items-center gap-3 rounded-lg border px-2.5 py-2 transition-colors",
      selected ? "border-accent bg-accent-subtle" : "border-line bg-surface hover:border-line-strong",
      !track.available && "opacity-60",
    )}>
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={!track.available}
        aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
        className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors", playing ? "bg-accent text-accent-fg" : "bg-subtle text-fg hover:bg-muted-surface")}
      >
        {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          role={onSelect ? "radio" : undefined}
          aria-checked={onSelect ? !!selected : undefined}
          disabled={disabled || !track.available || !onSelect}
          onClick={onSelect}
          className="flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-default"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-fg">{track.title}</span>
            <span className="block truncate text-xs text-fg-muted">
              {track.available ? track.artist || "Unknown artist" : "Not downloaded — run pnpm music-sync"}
            </span>
          </span>
          {selected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
        </button>
        {track.available && (
          <div className="mt-1.5">
            <Waveform peaks={peaks} progress={playing ? progress : 0} onSeek={playing ? onSeek : undefined} label={track.title} />
          </div>
        )}
      </div>
    </div>
  );
}

export function AudioPanel() {
  const { draft } = useStudio();
  const config = useStudioConfig().data;
  const music = useMusic();
  const m = draft.draft!.music ?? {};
  const enabled = m.enabled !== false;
  const volume = m.volume ?? 0.25;
  const tracks = music.data ?? [];
  const selected = m.file ?? tracks.find((t) => t.available)?.file;
  const preview = useTrackPreview(volume);
  const [previewError, setPreviewError] = useState(false);

  return (
    <>
      <Section title="Voice" description="ElevenLabs narration for this project.">
        <KeyValue items={[
          { label: "Voice model", value: config?.voiceModel ?? "—" },
          { label: "Language", value: config?.voiceLanguage ?? "—" },
          { label: "Script model", value: config?.scriptModel ?? "—" },
        ]} />
        <Hint>
          Apply edits reuses the saved narration. Changing the script creates new narration on the next preview or avatar render, which uses ElevenLabs credits.
          {" "}<Link to="/settings" className="font-medium text-accent hover:underline">Voice settings</Link>
        </Hint>
      </Section>

      <Section title="Background music">
        <SwitchRow title="Background music" description="Music bed under the narration" checked={enabled} onCheckedChange={(v) => draft.updateMusic({ enabled: v })} />
        <div className={cn("space-y-4", !enabled && "pointer-events-none opacity-50")} aria-disabled={!enabled}>
          <RangeField
            label="Music volume"
            value={Math.round(volume * 100)}
            onChange={(v) => draft.updateMusic({ volume: v / 100 })}
            min={0}
            max={100}
            unit="%"
            defaultValue={25}
            disabled={!enabled}
          />
          <SwitchRow
            title="Duck under the voice"
            description="Lower the music automatically while the narration plays"
            checked={m.duck !== false}
            disabled={!enabled}
            onCheckedChange={(v) => draft.updateMusic({ duck: v })}
          />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-fg">Track</span>
              <Badge>{tracks.filter((t) => t.available).length} available</Badge>
            </div>
            <div role="radiogroup" aria-label="Music track" className="space-y-1.5">
              {music.isPending
                ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)
                : tracks.map((t) => (
                  <TrackRow
                    key={t.file}
                    track={t}
                    selected={t.file === selected}
                    playing={preview.playing === t.file}
                    progress={preview.progress}
                    onSeek={preview.seek}
                    disabled={!enabled}
                    onSelect={() => draft.updateMusic({ file: t.file, title: `${t.title}${t.artist ? ` — ${t.artist}` : ""}` })}
                    onTogglePlay={() => preview.toggle(t, () => setPreviewError(true))}
                  />
                ))}
            </div>
            {previewError && <Hint className="text-warning">That track couldn't be played. Run <code className="font-mono">pnpm music-sync</code> in the project folder.</Hint>}
          </div>
        </div>
      </Section>
    </>
  );
}
