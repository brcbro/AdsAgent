import { toast } from "sonner";
import { Copy, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { dateTime, PROJECT_STATUS } from "@/lib/format";
import { copyText } from "@/lib/hooks";
import type { AspectRatio } from "@/lib/types";
import { KeyValue, RangeField, Section, Segmented } from "@/components/ui/primitives";
import { useStudio } from "../studio-context";
import { Link } from "react-router";
import { useProjectPerformance, useSuggestions } from "@/lib/queries";
import { SuggestionCard } from "../../performance/SuggestionCard";

function CopyValue({ value, label }: { value?: string; label: string }) {
  if (!value) return <>—</>;
  return (
    <button
      type="button"
      className="group inline-flex max-w-full items-center gap-1.5 text-right"
      onClick={async () => { if (await copyText(value)) toast.success(`${label} copied`); }}
      aria-label={`Copy ${label}`}
      title={value}
    >
      <span className="truncate font-mono text-xs">{value}</span>
      <Copy className="size-3.5 shrink-0 text-fg-muted group-hover:text-fg" />
    </button>
  );
}

export function SettingsPanel() {
  const { project, draft } = useStudio();
  const perf = useProjectPerformance().data?.[project.id];
  const suggestions = useSuggestions({ projectId: project.id }, !!perf).data?.suggestions ?? [];
  const d = draft.draft!;
  const isLocal = project.id.startsWith("local_");

  return (
    <>
      <Section title="Format">
        <Segmented<AspectRatio>
          label="Video format"
          className="w-full"
          value={d.aspectRatio ?? "16:9"}
          onChange={(v) => draft.update({ aspectRatio: v })}
          options={[
            { value: "9:16", label: <><RectangleVertical /> Vertical 9:16</> },
            { value: "16:9", label: <><RectangleHorizontal /> Horizontal 16:9</> },
          ]}
        />
        <p className="text-xs text-fg-muted">9:16 for Reels, TikTok and Stories with portrait talking-head avatars. 16:9 for feed placements and scene avatars.</p>
      </Section>

      <Section title="Export">
        <RangeField
          label="Export speed"
          value={d.outputSpeed ?? 1}
          onChange={(v) => draft.update({ outputSpeed: Math.round(v * 100) / 100 })}
          min={0.5}
          max={2}
          step={0.05}
          unit="×"
          defaultValue={1}
          hint="Baked into the exported MP4 on the next render or Apply edits. The player's speed menu only changes preview playback."
        />
        <RangeField
          label="Avatar on screen"
          value={d.introMs ?? 7000}
          onChange={(v) => draft.update({ introMs: v })}
          min={3000}
          max={10000}
          step={500}
          scale={0.001}
          unit="s"
          defaultValue={7000}
          format={(v) => `${(v / 1000).toFixed(1)} s`}
          hint={isLocal ? "Local previews always use a 3-second waveform intro." : "How long the presenter stays full-screen before B-roll starts."}
        />
      </Section>

      <Section title="Ad performance"
        description={perf ? "Last 30 days across the ads linked to this project." : "No linked ads yet. Name ads on Meta or Google after this project ID, or link them on the Performance page."}
        actions={<Link to="/performance" className="text-xs font-medium text-accent hover:underline">Open Performance</Link>}>
        {perf && (
          <KeyValue items={[
            { label: "Linked ads", value: `${perf.ads}${perf.winners ? ` · ${perf.winners} winner${perf.winners === 1 ? "" : "s"}` : ""}${perf.fatigued ? ` · ${perf.fatigued} fatigued` : ""}` },
            { label: "Spend", value: `€${perf.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
            { label: "Impressions", value: perf.impressions.toLocaleString() },
            { label: "Best hook rate", value: perf.bestHookRate === undefined ? "—" : `${(perf.bestHookRate * 100).toFixed(1)}%` },
            { label: "Best CTR", value: perf.bestCtr === undefined ? "—" : `${(perf.bestCtr * 100).toFixed(2)}%` },
            ...(perf.bestVariantKey ? [{ label: "Best variant", value: <span className="font-mono text-xs">{perf.bestVariantKey}</span> }] : []),
          ]} />
        )}
        {!!suggestions.length && (
          <div className="space-y-2" data-testid="project-suggestions">
            {suggestions.map((s) => <SuggestionCard key={s.id} s={s} compact />)}
          </div>
        )}
      </Section>

      <Section title="Render info">
        <KeyValue items={[
          { label: "Project ID", value: <CopyValue value={project.id} label="Project ID" /> },
          { label: "Status", value: PROJECT_STATUS[project.status]?.label ?? project.status },
          { label: "Output file", value: <CopyValue value={project.outputFile} label="Output path" /> },
          { label: "Created", value: dateTime(project.createdAt) },
          { label: "Last updated", value: dateTime(project.updatedAt) },
        ]} />
        {project.error && (
          <div className="rounded-lg border border-danger/20 bg-danger-subtle p-3">
            <div className="text-xs font-semibold text-danger">Last error</div>
            <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-fg-secondary">{project.error}</pre>
          </div>
        )}
      </Section>
    </>
  );
}
