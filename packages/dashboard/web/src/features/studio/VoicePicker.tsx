import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Mic, Pause, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/format";
import type { SavedVoice } from "@/lib/prefs";
import { useHeygenVoices } from "@/lib/queries";
import type { HeyGenVoice } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EmptyState, SearchInput, Segmented, Skeleton } from "@/components/ui/primitives";

export type VoiceSource = "private" | "public";
/** The HeyGen library has well over a thousand German voices; search narrows the rest. */
const MAX_ROWS = 150;

export const toSavedVoice = (v: HeyGenVoice): SavedVoice => ({ id: v.voice_id, name: v.name, type: v.type });

/** One shared player, so starting a preview stops the previous one. */
export function usePreviewPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  function toggle(v: HeyGenVoice) {
    if (!v.preview_audio_url) return;
    if (playing === v.voice_id) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause();
    const el = new Audio(v.preview_audio_url);
    audio.current = el;
    el.onended = () => setPlaying((p) => (p === v.voice_id ? null : p));
    el.onerror = () => setPlaying(null);
    void el.play().then(() => setPlaying(v.voice_id)).catch(() => setPlaying(null));
  }
  return { playing, toggle };
}

/**
 * HeyGen voice list: the account's own voices ("My voices") or the HeyGen library (German).
 * The chosen voice speaks the whole script; no ElevenLabs narration is used for avatar videos.
 */
export function VoiceList({ value, onChange, suggestedVoiceId, gender, className, compact }: {
  value: SavedVoice | null;
  onChange: (v: SavedVoice) => void;
  /** The avatar's own default voice, shown first and marked. */
  suggestedVoiceId?: string;
  /** Presenter gender, used to sort matching voices first. */
  gender?: string;
  className?: string;
  compact?: boolean;
}) {
  const [source, setSource] = useState<VoiceSource>(value?.type ?? "private");
  const [search, setSearch] = useState("");
  const voices = useHeygenVoices(source);
  const { playing, toggle } = usePreviewPlayer();

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = (voices.data?.voices ?? []).filter((v) => !q || v.name.toLowerCase().includes(q) || v.voice_id.includes(q));
    const g = gender?.toLowerCase();
    const rank = (v: HeyGenVoice) => (v.voice_id === suggestedVoiceId ? 0 : g && v.gender === g ? 1 : 2);
    return [...all].sort((a, b) => rank(a) - rank(b));
  }, [voices.data, search, gender, suggestedVoiceId]);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <Segmented<VoiceSource>
        label="Voice source"
        size="sm"
        className="w-full"
        value={source}
        onChange={setSource}
        options={[{ value: "private", label: "My voices" }, { value: "public", label: "HeyGen voices" }]}
      />
      <SearchInput value={search} onChange={setSearch} placeholder={source === "private" ? "Search your voices" : "Search German voices"} />
      <div role="radiogroup" aria-label="HeyGen voices" className={cn("min-h-0 flex-1 overflow-y-auto rounded-md border border-line", compact ? "max-h-60" : "max-h-[52vh]")}>
        {voices.isPending ? (
          <div className="space-y-1 p-1.5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
        ) : voices.isError ? (
          <EmptyState icon={<Mic />} title="Couldn't load voices" description={(voices.error as Error).message}
            action={<Button size="sm" variant="secondary" onClick={() => voices.refetch()}>Try again</Button>} />
        ) : !list.length ? (
          <EmptyState icon={<Mic />} title={search ? "No voices match" : source === "private" ? "No voices of your own yet" : "No German voices found"}
            description={source === "private" ? "Clone or record a voice in HeyGen, then reopen this list. Or pick one of the HeyGen voices." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {list.slice(0, MAX_ROWS).map((v) => {
              const selected = value?.id === v.voice_id;
              return (
                <li key={v.voice_id} className={cn("flex items-center gap-2 px-2 py-1.5", selected && "bg-accent/5")}>
                  <button type="button" disabled={!v.preview_audio_url} onClick={() => toggle(v)}
                    aria-label={playing === v.voice_id ? `Stop preview of ${v.name}` : `Play preview of ${v.name}`}
                    className="grid size-7 shrink-0 place-items-center rounded-full border border-line text-fg-secondary transition-colors hover:border-line-strong hover:text-fg disabled:opacity-40">
                    {playing === v.voice_id ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
                  </button>
                  <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(toSavedVoice(v))}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg" title={v.name}>{v.name}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {/* Own recordings often share a name ("heygen"), so a short ID tells them apart. */}
                        {[v.gender && v.gender[0].toUpperCase() + v.gender.slice(1), v.language, v.type === "private" ? `ID ${v.voice_id.slice(0, 6)}` : undefined].filter(Boolean).join(" · ") || "Voice"}
                      </span>
                    </span>
                    {v.voice_id === suggestedVoiceId && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-subtle px-1.5 py-0.5 text-[11px] text-fg-secondary"><Sparkles className="size-3" /> Avatar's voice</span>
                    )}
                    {selected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {list.length > MAX_ROWS && (
              <li className="px-3 py-2 text-center text-xs text-fg-muted">Showing {MAX_ROWS} of {list.length} voices. Search to narrow the list.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
