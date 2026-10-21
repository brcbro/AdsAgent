import { useState } from "react";
import { Inbox } from "lucide-react";
import { useSuggestions } from "@/lib/queries";
import type { Suggestion } from "@/lib/types";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/primitives";
import { SuggestionCard } from "./SuggestionCard";

type View = "open" | "accepted" | "dismissed";

/** The suggestions inbox: account actions from the scores plus what to try in the next brief, from the KB. */
export function SuggestionsSection() {
  const [view, setView] = useState<View>("open");
  const q = useSuggestions({ status: [view] });
  const list = q.data?.suggestions ?? [];
  const actions = list.filter((s) => s.kind === "ad_to_scale" || s.kind === "ad_to_kill" || s.kind === "refresh_hook");
  const brief = list.filter((s) => !actions.includes(s));

  return (
    <section className="mt-8" data-testid="perf-suggestions">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Suggestions</h2>
          <p className="text-xs text-fg-muted">What to scale, pause or refresh, and what the next brief should try. Accepting records the decision; it never changes an ad on the platform.</p>
        </div>
        <Segmented<View> label="Suggestion status" size="sm" value={view} onChange={setView}
          options={[{ value: "open", label: "Open" }, { value: "accepted", label: "Accepted" }, { value: "dismissed", label: "Dismissed" }]} />
      </div>
      {q.isPending ? <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
        : !list.length ? (
          <EmptyState icon={<Inbox />} title={view === "open" ? "Nothing to decide" : `No ${view} suggestions`}
            description={view === "open" ? "Account actions appear after a sync once an ad is a clear winner, loser or fatigued; brief suggestions appear once the Winning patterns have data." : ""} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Group title="Account actions" items={actions} />
            <Group title="For the next brief" items={brief} />
          </div>
        )}
    </section>
  );
}

function Group({ title, items }: { title: string; items: Suggestion[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">{title} <span className="font-normal">· {items.length}</span></h3>
      {items.length ? <div className="space-y-2">{items.map((s) => <SuggestionCard key={s.id} s={s} />)}</div> : <p className="text-sm text-fg-muted">None right now.</p>}
    </div>
  );
}
