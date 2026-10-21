import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Lightbulb, MessageSquareQuote, Pause, RefreshCw, Scissors, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import type { Suggestion, SuggestionKind } from "@/lib/types";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";

export const KIND_META: Record<SuggestionKind, { label: string; icon: typeof Lightbulb; tone: "success" | "danger" | "warning" | "accent" | "info" }> = {
  ad_to_scale: { label: "Scale", icon: TrendingUp, tone: "success" },
  ad_to_kill: { label: "Pause", icon: Pause, tone: "danger" },
  refresh_hook: { label: "Refresh hook", icon: RefreshCw, tone: "warning" },
  hook: { label: "Hook", icon: Flame, tone: "accent" },
  angle: { label: "Angle", icon: Lightbulb, tone: "accent" },
  cta: { label: "CTA", icon: MessageSquareQuote, tone: "accent" },
  variant_to_render: { label: "Variant", icon: TrendingUp, tone: "info" },
  pacing: { label: "Pacing", icon: Scissors, tone: "info" },
};

type OutcomeStatus = NonNullable<Suggestion["outcome"]>["status"];
const OUTCOME_LABEL: Record<OutcomeStatus, string> = { pending: "Outcome pending", improved: "Improved", flat: "No change", worse: "Got worse", won: "Won", mixed: "Mixed", lost: "Lost" };
const OUTCOME_TONE: Record<OutcomeStatus, "neutral" | "success" | "warning" | "danger"> = { pending: "neutral", improved: "success", flat: "neutral", worse: "danger", won: "success", mixed: "warning", lost: "danger" };

/** One recommendation with its evidence. Accept and dismiss only record the decision; nothing touches the ad platforms. */
export function SuggestionCard({ s, compact, extra }: { s: Suggestion; compact?: boolean; extra?: React.ReactNode }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<"accept" | "dismiss" | "reopen" | null>(null);
  const meta = KIND_META[s.kind];
  const Icon = meta.icon;

  async function act(action: "accept" | "dismiss" | "reopen") {
    setBusy(action);
    try {
      await api.suggestionAction(s.id, action);
      await client.invalidateQueries({ queryKey: ["suggestions"] });
      await client.invalidateQueries({ queryKey: ["performance"] });
    } catch (err) { toast.error("Couldn't save", { description: errorMessage(err) }); }
    finally { setBusy(null); }
  }

  return (
    <article className={cn("rounded-xl border bg-surface shadow-xs", compact ? "p-3" : "p-4", s.status === "dismissed" ? "border-line opacity-60" : s.status === "accepted" ? "border-success/40" : "border-line")} data-testid="suggestion-card" data-kind={s.kind}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-4", meta.tone === "danger" ? "bg-danger-subtle text-danger" : meta.tone === "warning" ? "bg-warning-subtle text-warning" : meta.tone === "success" ? "bg-success-subtle text-success" : "bg-accent-subtle text-accent")}>
          <Icon aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{s.title}</h3>
            <Badge tone="neutral">{meta.label}</Badge>
            {s.status === "accepted" && <Badge tone="success" dot>Accepted</Badge>}
            {s.status === "dismissed" && <Badge tone="neutral">Dismissed</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{s.body}</p>
          <p className="mt-1 text-xs text-fg-muted" title={[...s.patternIds, ...s.exampleAdIds].join(", ")}>{s.rationale}</p>
          {s.status === "accepted" && s.outcome && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs" data-testid="suggestion-outcome">
              <Badge tone={OUTCOME_TONE[s.outcome.status]} dot>{OUTCOME_LABEL[s.outcome.status]}</Badge>
              <span className="text-fg-secondary">{s.outcome.summary}</span>
            </p>
          )}
          {extra}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {s.status === "open" ? (
            <>
              <Button size="sm" variant="secondary" loading={busy === "accept"} onClick={() => act("accept")}><Check /> Accept</Button>
              <IconButton label="Dismiss" size="icon-sm" onClick={() => act("dismiss")}><X /></IconButton>
            </>
          ) : (
            <Button size="sm" variant="ghost" loading={busy === "reopen"} onClick={() => act("reopen")}>Reopen</Button>
          )}
        </div>
      </div>
    </article>
  );
}
