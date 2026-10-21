import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Quote, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { cn, relativeTime } from "@/lib/format";
import { keys, usePatterns } from "@/lib/queries";
import type { Pattern, TeardownState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Skeleton, Switch } from "@/components/ui/primitives";

const DIMENSION_LABEL: Record<string, string> = {
  hook_type: "Hook type", angle: "Angle", persona: "Persona", emotional_trigger: "Trigger", claim_structure: "Claim", cta_style: "CTA",
  address_form: "Address", uses_numbers: "Numbers", visual_style: "Visuals", pacing: "Pacing", music_energy: "Music", duration: "Duration", hook_type_x_persona: "Hook × persona",
};
const fmtX = (x?: number) => (x === undefined ? "—" : `${x.toFixed(x >= 10 ? 0 : 1)}×`);

/** The Winning Patterns KB: what the data says works, with the evidence, and a switch to keep a pattern out of the prompts. */
export function PatternsSection({ teardown, onRun }: { teardown: TeardownState; onRun: () => Promise<void> }) {
  const patterns = usePatterns();
  const client = useQueryClient();
  const [running, setRunning] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const data = patterns.data;
  const canRun = teardown.llmConfigured && !teardown.running && !running;

  async function run() {
    setRunning(true);
    try { await onRun(); await client.invalidateQueries({ queryKey: keys.patterns }); }
    finally { setRunning(false); }
  }
  async function toggle(p: Pattern) {
    try {
      await api.togglePattern(p.id, !p.disabled);
      await client.invalidateQueries({ queryKey: keys.patterns });
      toast.success(p.disabled ? "Pattern back in the prompts" : "Pattern left out of the prompts");
    } catch (err) { toast.error("Couldn't save", { description: errorMessage(err) }); }
  }

  const counts = teardown.counts;
  const status = `${counts.done} torn down${counts.needsTranscript ? ` · ${counts.needsTranscript} need a transcript` : ""}${counts.errors ? ` · ${counts.errors} failed` : ""}${counts.competitors ? ` · ${counts.competitors} competitor${counts.competitors === 1 ? "" : "s"}` : ""}`;

  return (
    <section className="mt-8" data-testid="perf-patterns">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Winning patterns</h2>
          <p className="text-xs text-fg-muted">
            Learned from torn-down winners and losers; injected into every script prompt. {status}
            {data?.updatedAt ? ` · updated ${relativeTime(data.updatedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.promptBlock && <Button variant="ghost" size="sm" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide prompt block" : "Show prompt block"}</Button>}
          <Button variant="secondary" size="sm" loading={running || teardown.running} disabled={!canRun} onClick={run}
            title={teardown.llmConfigured ? `Tears down winners, losers and competitor files; at most ${teardown.maxPerRun} LLM calls per run` : "Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env first"}
            data-testid="perf-run-teardowns">
            <Sparkles /> Run teardowns
          </Button>
        </div>
      </div>

      {showPrompt && data?.promptBlock && (
        <pre className="mb-4 max-h-64 overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs whitespace-pre-wrap text-fg-secondary">{data.promptBlock}</pre>
      )}

      {patterns.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : !data?.patterns.length ? (
        <EmptyState icon={<Lightbulb />} title="No patterns yet"
          description={counts.done < 5
            ? `Patterns need at least 5 torn-down ads with scores. ${teardown.llmConfigured ? "Run teardowns after a sync to analyse winners and losers." : "Add an LLM key to .env so ads can be analysed."}`
            : "The torn-down ads don't differ enough yet; patterns appear once a hook type, angle or pacing clearly ranks above or below average."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.patterns.map((p) => <PatternCard key={p.id} pattern={p} onToggle={() => toggle(p)} />)}
        </div>
      )}

      {!!data?.hooks.length && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-xs">
          <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-fg"><Quote className="size-4 text-fg-muted" /> Best-performing hooks</h3>
          <ul className="space-y-1.5">
            {data.hooks.map((h) => (
              <li key={h.adId} className="flex items-start gap-2 text-sm">
                <Badge tone="neutral" className="mt-0.5 shrink-0">{h.hookType ?? "hook"}</Badge>
                <span className="text-fg">„{h.hookText}“</span>
                <span className="ml-auto shrink-0 text-xs text-fg-muted" title={h.adName}>top {Math.round((1 - h.percentile) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function PatternCard({ pattern: p, onToggle }: { pattern: Pattern; onToggle: () => void }) {
  const positive = p.direction === "positive";
  return (
    <article className={cn("rounded-xl border bg-surface p-4 shadow-xs", p.disabled ? "border-line opacity-60" : positive ? "border-success/30" : "border-danger/30")} data-testid="pattern-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{DIMENSION_LABEL[p.dimension] ?? p.dimension}</div>
          <div className="truncate text-sm font-semibold text-fg" title={p.value}>{p.value}</div>
        </div>
        <Badge tone={positive ? "success" : "danger"}>{positive ? <ThumbsUp className="size-3" /> : <ThumbsDown className="size-3" />} {fmtX(p.lift)} rank</Badge>
      </div>
      <p className="mt-2 text-xs text-fg-secondary">{p.summaryEn}</p>
      <dl className="tabular mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        <div><dt className="inline">n </dt><dd className="inline font-medium text-fg">{p.sampleSize}</dd></div>
        <div><dt className="inline">winners </dt><dd className="inline font-medium text-fg">{Math.round(p.winnerShare * 100)}%</dd></div>
        {p.hookLift !== undefined && <div><dt className="inline">hook </dt><dd className="inline font-medium text-fg">{fmtX(p.hookLift)}</dd></div>}
        {p.ctrLift !== undefined && <div><dt className="inline">CTR </dt><dd className="inline font-medium text-fg">{fmtX(p.ctrLift)}</dd></div>}
      </dl>
      {p.evidence[0]?.hookText && <p className="mt-2 truncate text-xs text-fg-muted italic" title={p.evidence.map((e) => e.adName ?? e.adId).join(", ")}>e.g. „{p.evidence[0].hookText}“</p>}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
        <span className="text-xs text-fg-muted">{p.disabled ? "Left out of prompts" : "Used in prompts"}</span>
        <Switch checked={!p.disabled} onCheckedChange={onToggle} label={`Use pattern ${p.value} in prompts`} />
      </div>
    </article>
  );
}
