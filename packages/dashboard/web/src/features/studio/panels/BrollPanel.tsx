import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { useBroll } from "@/lib/queries";
import { Hint, Section, Segmented, SwitchRow } from "@/components/ui/primitives";
import { useStudio } from "../studio-context";
import { applyClipState, BrollBrowser } from "../BrollBrowser";

const CUTS = ["1800", "2500", "3500"] as const;

export function BrollPanel() {
  const { draft } = useStudio();
  const broll = useBroll();
  const d = draft.draft!;
  const cut = String(d.brollCutMs ?? 1800);
  const options = [...CUTS, ...(CUTS.includes(cut as (typeof CUTS)[number]) ? [] : [cut])];
  const pinned = d.brollPinned ?? [];
  const excluded = d.brollExcluded ?? [];

  return (
    <>
      <Section title="B-roll settings" description="Matching clips are picked automatically from the library for each sentence.">
        <SwitchRow
          title="Use B-roll after the intro"
          description="Off keeps the whole video on the presenter or waveform"
          checked={d.fullAvatar !== true}
          onCheckedChange={(v) => draft.update({ fullAvatar: !v })}
        />
        <div>
          <div className="mb-1.5 text-sm font-medium text-fg">Clip length</div>
          <Segmented
            label="Clip length"
            className="w-full"
            value={cut}
            disabled={d.fullAvatar === true}
            onChange={(v) => draft.update({ brollCutMs: Number(v) })}
            options={options.map((o) => ({ value: o, label: `${Number(o) / 1000}s`, title: o === "1800" ? "Fast cuts" : o === "3500" ? "Calm pacing" : undefined }))}
          />
          <Hint>Shorter clips feel faster. Use Apply edits to update a finished video.</Hint>
        </div>
      </Section>

      <Section
        title="Library"
        description={broll.data ? `${broll.data.length} clips ready` : "Loading clips…"}
        actions={<Link to="/library/broll" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Full library <ExternalLink className="size-3" /></Link>}
      >
        {(pinned.length > 0 || excluded.length > 0) && (
          <div className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-xs text-fg-secondary">
            <span><strong className="font-semibold text-fg">{pinned.length}</strong> pinned · <strong className="font-semibold text-fg">{excluded.length}</strong> excluded</span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => draft.update({ brollPinned: [], brollExcluded: [] })}>Clear all</button>
          </div>
        )}
        <BrollBrowser
          compact
          choices={{
            pinned,
            excluded,
            setState: (file, next) => draft.update((d) => {
              const lists = applyClipState({ pinned: d.brollPinned ?? [], excluded: d.brollExcluded ?? [] }, file, next);
              return { brollPinned: lists.pinned, brollExcluded: lists.excluded };
            }),
          }}
        />
        <Hint>Pinned clips are always used, each where it fits the script best (extra pins beyond the number of cuts are skipped). Changes apply on the next render or Apply edits.</Hint>
      </Section>
    </>
  );
}
