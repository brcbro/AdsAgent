import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play } from "lucide-react";
import { cn } from "@/lib/format";
import type { SavedVoice } from "@/lib/prefs";
import { useAvatarVoice } from "@/lib/queries";
import type { HeyGenVoice } from "@/lib/types";
import { Skeleton } from "@/components/ui/primitives";
import { usePreviewPlayer, VoiceList } from "./VoicePicker";

/** "eleven_v4" → "ElevenLabs V4" */
export function voiceModelLabel(model?: string): string {
  const m = /^eleven_(.+)$/.exec(model ?? "");
  if (!m) return model ? model : "ElevenLabs V4";
  return `ElevenLabs ${m[1].replace(/_/g, " ").replace(/\bv(\d)/i, "V$1").replace(/\b(multilingual|turbo|flash)\b/, (w) => w[0].toUpperCase() + w.slice(1))}`;
}

/**
 * The voice follows the avatar: picking an avatar selects its own HeyGen voice, which every look of
 * that avatar shares. HeyGen speaks it through its ElevenLabs engine. A different voice is optional.
 */
export function AvatarVoicePanel({ avatarId, value, onChange, initialVoiceId }: {
  avatarId?: string;
  value: SavedVoice | null;
  onChange: (v: SavedVoice | null) => void;
  /** The project's saved voice when the dialog opened, so an earlier override is kept. */
  initialVoiceId?: string;
}) {
  const auto = useAvatarVoice(avatarId);
  const own = auto.data?.avatarId === avatarId ? auto.data?.voice ?? null : null;
  const [custom, setCustom] = useState(false);
  const firstAvatar = useRef(avatarId);

  // A new avatar always starts on its own voice. On the avatar the dialog opened with,
  // a previously chosen different voice is kept as an override.
  useEffect(() => {
    if (!avatarId || !auto.data || auto.data.avatarId !== avatarId) return;
    const keepOverride = avatarId === firstAvatar.current && !!initialVoiceId && initialVoiceId !== own?.voice_id;
    setCustom(keepOverride);
    if (!keepOverride) onChange(own ? { id: own.voice_id, name: own.name, type: own.type } : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, auto.data]);

  const model = voiceModelLabel(auto.data?.voiceModel);

  if (!avatarId) {
    return <p className="rounded-md border border-dashed border-line p-3 text-xs text-fg-muted">Pick an avatar — its own voice is selected automatically.</p>;
  }

  return (
    <div className="space-y-3">
      {auto.isPending ? <Skeleton className="h-16 rounded-md" /> : auto.isError ? (
        <p className="rounded-md bg-danger-subtle p-2.5 text-xs text-danger">Couldn't load this avatar's voice: {(auto.error as Error).message}</p>
      ) : own ? (
        <VoiceCard voice={own} model={model} active={!custom} label="Avatar's own voice"
          onUse={custom ? () => { setCustom(false); onChange({ id: own.voice_id, name: own.name, type: own.type }); } : undefined} />
      ) : (
        <p className="rounded-md border border-line p-2.5 text-xs text-fg-secondary">This avatar has no voice of its own. Choose one below.</p>
      )}

      {(custom || (!auto.isPending && !own)) ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-fg-secondary">Different voice</div>
          <VoiceList compact value={custom ? value : null} onChange={(v) => { setCustom(true); onChange(v); }} />
        </div>
      ) : own && (
        <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setCustom(true)}>
          Use a different voice
        </button>
      )}
      <p className="text-xs text-fg-muted">HeyGen generates the video and the audio; its voice engine is <strong className="font-medium text-fg-secondary">{model}</strong>. All looks of this avatar use the same voice.</p>
    </div>
  );
}

function VoiceCard({ voice, model, active, label, onUse }: { voice: HeyGenVoice; model: string; active: boolean; label: string; onUse?: () => void }) {
  const { playing, toggle } = usePreviewPlayer();
  return (
    <div className={cn("flex items-center gap-2.5 rounded-md border p-2.5", active ? "border-accent bg-accent/5" : "border-line")} data-testid="avatar-voice">
      <button type="button" disabled={!voice.preview_audio_url} onClick={() => toggle(voice)}
        aria-label={playing === voice.voice_id ? `Stop preview of ${voice.name}` : `Play preview of ${voice.name}`}
        className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-fg-secondary hover:border-line-strong hover:text-fg disabled:opacity-40">
        {playing === voice.voice_id ? <Pause className="size-3.5" /> : voice.preview_audio_url ? <Play className="size-3.5 translate-x-px" /> : <Mic className="size-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{label}</div>
        <div className="truncate text-sm font-medium text-fg" title={voice.name}>{voice.name}</div>
        <div className="truncate text-xs text-fg-muted">{[voice.gender && voice.gender[0].toUpperCase() + voice.gender.slice(1), voice.language, model].filter(Boolean).join(" · ")}</div>
      </div>
      {onUse && <button type="button" className="shrink-0 text-xs font-medium text-accent hover:underline" onClick={onUse}>Use</button>}
    </div>
  );
}
