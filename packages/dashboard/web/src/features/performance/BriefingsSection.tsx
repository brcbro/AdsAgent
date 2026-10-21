import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { keys, useKbBriefings } from "@/lib/queries";
import type { KbBriefing } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Select, Skeleton } from "@/components/ui/primitives";

/** Briefings generated from the Winning Patterns KB; each is a JSON file the golden path can run and a prefilled brief for the Agent. */
export function BriefingsSection({ llmConfigured }: { llmConfigured: boolean }) {
  const q = useKbBriefings();
  const client = useQueryClient();
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const list = q.data?.briefings ?? [];

  async function generate() {
    setBusy(true);
    try {
      const r = await api.generateBriefings({ count });
      await client.invalidateQueries({ queryKey: keys.kbBriefings });
      toast.success(`${r.generated.length} briefing${r.generated.length === 1 ? "" : "s"} written to data/briefings/`, { description: r.generated.map((b) => b.angle).join(" · ") });
    } catch (err) { toast.error("Couldn't generate briefings", { description: errorMessage(err) }); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-8" data-testid="perf-briefings">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Briefings from the data</h2>
          <p className="text-xs text-fg-muted">Claude drafts deliberately different briefings from the Winning patterns and the last angles used. Files land in <span className="font-mono">data/briefings/</span> for <span className="font-mono">pnpm golden</span>; or send one to the Agent.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select aria-label="How many briefings" className="h-8 w-20 text-xs" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[1, 3, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Button variant="secondary" size="sm" loading={busy} disabled={!llmConfigured} onClick={generate} data-testid="perf-generate-briefings"
            title={llmConfigured ? "One LLM call writes the briefing files" : "Set an LLM key in .env first"}>
            <Sparkles /> Generate briefings
          </Button>
        </div>
      </div>
      {q.isPending ? <Skeleton className="h-24" /> : !list.length ? (
        <EmptyState icon={<FileText />} title="No generated briefings yet" description="Generate a batch once the Winning patterns have data; without data the briefings fall back to proven direct-response mechanics." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">{list.map((b) => <BriefingCard key={b.id} b={b} />)}</div>
      )}
    </section>
  );
}

function briefText(b: KbBriefing): string {
  return [`Briefing „${b.angle}“`, `Zielgruppe: ${b.persona}`, `Schmerzpunkt: ${b.painPoint}`, `Versprechen: ${b.promise}`, `Ton: ${b.tone}`,
    `Hook-Ideen: ${b.hookConcepts.join(" | ")}`, `Body: ${b.bodyConcept}`, `CTA: ${b.ctaConcepts.join(" | ")}`, `Visuals: ${b.visualDirection.join(", ")}`].join("\n");
}

function BriefingCard({ b }: { b: KbBriefing }) {
  return (
    <article className="rounded-xl border border-line bg-surface p-4 shadow-xs" data-testid="briefing-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{b.angle}</h3>
        <span className="shrink-0 text-xs text-fg-muted">{relativeTime(b.createdAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{b.persona}</p>
      <ul className="mt-2 space-y-1 text-sm text-fg-secondary">
        {b.hookConcepts.map((h) => <li key={h} className="flex gap-2"><span aria-hidden className="text-fg-muted">›</span><span>{h}</span></li>)}
      </ul>
      {!!b.usedPatternIds?.length && <div className="mt-2 flex flex-wrap gap-1">{b.usedPatternIds.map((id) => <Badge key={id} tone="accent" className="font-mono">{id}</Badge>)}</div>}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-xs">
        <span className="truncate font-mono text-fg-muted" title={b.file}>{b.file.split("/").pop()}</span>
        <Link to={`/agent?brief=${encodeURIComponent(briefText(b))}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><Bot className="size-3.5" /> Send to Agent</Link>
      </div>
    </article>
  );
}
