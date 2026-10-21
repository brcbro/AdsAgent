import { useState } from "react";
import { toast } from "sonner";
import { Check, MoveVertical, Star } from "lucide-react";
import { cn, splitSentences } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { usePresets } from "@/lib/queries";
import type { CaptionPreset } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Chip, Hint, RangeField, Section, Skeleton } from "@/components/ui/primitives";
import { useStudio } from "../studio-context";
import { CaptionSample } from "../captionStyle";

type Filter = "all" | "word" | "phrase" | "favorites";

export function CaptionsPanel() {
  const { project, draft, setAdjustingCaptions } = useStudio();
  const presetsQuery = usePresets();
  const presets = presetsQuery.data ?? [];
  const [prefs, setPrefs] = usePrefs();
  const [filter, setFilter] = useState<Filter>("all");
  const c = draft.draft!.captions ?? {};
  const preset = presets.find((p) => p.id === (c.presetId ?? "meta-clean")) ?? presets[0];
  const fontSize = c.fontSize ?? preset?.fontSize ?? 32;
  const bottom = c.bottomPercent ?? preset?.bottomPercent ?? 18;
  const sample = splitSentences(draft.draft!.scriptDe ?? "")[0]?.split(/\s+/).slice(0, 5).join(" ");

  const visible = presets.filter((p) =>
    filter === "all" ? true : filter === "favorites" ? prefs.favoritePresets.includes(p.id) : p.mode === filter);

  const choose = (p: CaptionPreset) => draft.updateCaptions({ presetId: p.id, fontSize: p.fontSize, bottomPercent: p.bottomPercent });
  const toggleFavorite = (id: string) =>
    setPrefs((prev) => ({ favoritePresets: prev.favoritePresets.includes(id) ? prev.favoritePresets.filter((x) => x !== id) : [...prev.favoritePresets, id] }));

  return (
    <>
      <Section title="Preview" description="Approximate look. The final render uses the same font, colours and position.">
        {preset ? (
          <div className="mx-auto overflow-hidden rounded-lg bg-stage shadow-md ring-1 ring-black/5" style={{ aspectRatio: "9 / 16", height: 300 }}>
            <div className="relative size-full bg-[radial-gradient(120%_80%_at_30%_20%,#334155_0%,#0f172a_55%,#020617_100%)]">
              <div className="absolute inset-x-3 flex translate-y-1/2 justify-center text-center" style={{ bottom: `${bottom}%` }}>
                <CaptionSample preset={preset} fontSize={Math.max(10, Math.round(fontSize * 0.42))} text={sample} />
              </div>
            </div>
          </div>
        ) : <Skeleton className="mx-auto h-[300px] w-[169px]" />}
      </Section>

      <Section title="Size and position">
        <RangeField label="Font size" value={fontSize} onChange={(v) => draft.updateCaptions({ fontSize: v })} min={20} max={54} unit="px" defaultValue={preset?.fontSize} />
        <RangeField label="Distance from bottom" value={bottom} onChange={(v) => draft.updateCaptions({ bottomPercent: v })} min={5} max={85} unit="%" defaultValue={preset?.bottomPercent} />
        <Button variant="secondary" className="w-full" disabled={project.status !== "done"} onClick={() => setAdjustingCaptions(true)}>
          <MoveVertical /> Adjust on the video
        </Button>
        {project.status !== "done" && <Hint className="-mt-2">Available once the video has been rendered.</Hint>}
      </Section>

      <Section
        title="Style"
        description={`${presets.length} presets · word-by-word or phrase karaoke`}
        actions={preset && prefs.defaultPresetId !== preset.id ? (
          <Button size="sm" variant="ghost" onClick={() => { setPrefs({ defaultPresetId: preset.id }); toast.success(`"${preset.name}" is now the default for new videos`); }}>
            Set as default
          </Button>
        ) : undefined}
      >
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter presets">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} count={presets.length}>All</Chip>
          <Chip active={filter === "word"} onClick={() => setFilter("word")} count={presets.filter((p) => p.mode === "word").length}>Word by word</Chip>
          <Chip active={filter === "phrase"} onClick={() => setFilter("phrase")} count={presets.filter((p) => p.mode === "phrase").length}>Phrase</Chip>
          <Chip active={filter === "favorites"} onClick={() => setFilter("favorites")} count={prefs.favoritePresets.length}>Favorites</Chip>
        </div>
        <div role="radiogroup" aria-label="Caption style" className="grid grid-cols-2 gap-2">
          {presetsQuery.isPending && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}
          {visible.map((p) => {
            const active = p.id === preset?.id;
            const fav = prefs.favoritePresets.includes(p.id);
            return (
              <div key={p.id} className={cn(
                "group relative overflow-hidden rounded-lg border bg-surface transition-all duration-150",
                active ? "border-accent ring-2 ring-accent/20" : "border-line hover:border-line-strong hover:shadow-sm",
              )}>
                <button type="button" role="radio" aria-checked={active} onClick={() => choose(p)} className="block w-full text-left">
                  <div className="grid h-16 place-items-center bg-[linear-gradient(160deg,#1e293b_0%,#0b0b0f_70%)] px-2">
                    <CaptionSample preset={p} fontSize={Math.max(12, Math.round(p.fontSize * 0.42))} text="Die meisten Trader" />
                  </div>
                  <div className="px-2.5 py-2 pr-8">
                    <div className="truncate text-sm font-medium text-fg">{p.name}</div>
                    <div className="text-xs text-fg-muted">{p.mode === "word" ? "Word by word" : "Phrase"}{prefs.defaultPresetId === p.id ? " · default" : ""}</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavorite(p.id)}
                  aria-label={fav ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`}
                  aria-pressed={fav}
                  className={cn("absolute right-1.5 bottom-2 grid size-6 place-items-center rounded transition-opacity hover:bg-subtle",
                    fav ? "text-warning" : "text-fg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                >
                  <Star className={cn("size-3.5", fav && "fill-current")} />
                </button>
                {active && <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-fg shadow-sm"><Check className="size-3" /></span>}
              </div>
            );
          })}
        </div>
        {filter === "favorites" && !visible.length && <Hint>Star a preset to keep it here.</Hint>}
      </Section>
    </>
  );
}
