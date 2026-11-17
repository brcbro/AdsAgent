import { Popover } from "radix-ui";
import { Sparkles } from "lucide-react";
import { useSuggestions } from "@/lib/queries";
import type { Suggestion } from "@/lib/types";
import { Button } from "@/components/ui/button";

const stripLead = (title: string) => title.replace(/^(Open with a|Lead with the|Close with a)\s/, "");
/** Short label for the list; the brief itself keeps the full title. */
const clean = (title: string) => stripLead(title).replace(/\s(hook|angle|CTA)$/, "");
const kindLabel = (k: Suggestion["kind"]) => (k === "hook" ? "Hook" : k === "angle" ? "Angle" : "CTA");
const brief = (s: Suggestion) => `${s.kind === "hook" ? "Hook idea" : s.kind === "angle" ? "Angle" : "CTA"}: ${stripLead(s.title)} — ${s.body}`;

/**
 * Data-backed ideas from the winning ads, in one popover. Picking one adds a line to the brief,
 * so the agent builds on it. Renders nothing until there are ideas. With `label` it is a text
 * button (empty screen); without, a small icon button in the message box.
 */
export function Ideas({ onPick, label }: { onPick: (line: string) => void; label?: string }) {
  const q = useSuggestions({ kind: ["hook", "angle", "cta"], status: ["open", "accepted"] });
  const list = (q.data?.suggestions ?? []).slice(0, 8);
  if (!list.length) return null;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {label
          ? <Button size="sm" variant="secondary"><Sparkles className="text-accent" /> {label}</Button>
          : <Button size="icon-sm" variant="ghost" aria-label="Ideas from winning ads" title="Ideas from winning ads"><Sparkles /></Button>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={label ? "center" : "end"} side="top" sideOffset={8} data-testid="suggested-hooks"
          className="z-50 w-[min(92vw,24rem)] rounded-lg border border-line bg-surface p-1.5 shadow-lg animate-fade-in">
          <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-muted">From winning ads</p>
          {list.map((s) => (
            <Popover.Close asChild key={s.id}>
              <button type="button" onClick={() => onPick(brief(s))} title={s.rationale}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-subtle hover:text-fg">
                <span className="mt-0.5 shrink-0 rounded bg-subtle px-1.5 text-[11px] font-medium text-fg-muted">{kindLabel(s.kind)}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{clean(s.title)}</span>
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
