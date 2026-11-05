import { useEffect, useState } from "react";
import { spokenSeconds } from "@/lib/format";
import { Hint, Label, Section, Textarea } from "@/components/ui/primitives";

export type HookParts = { hook: string; rest: string };

/**
 * Splits the script where the first sentence ends — the same rule the renderer uses
 * (packages/pipeline/src/timing.ts hookEndMs) to hand over from the presenter to B-roll.
 */
export function splitHook(script: string): HookParts {
  const m = /^\s*[\s\S]*?[.!?…]["»“”']?(?=\s|$)/.exec(script);
  if (!m) return { hook: script.trim(), rest: "" };
  return { hook: m[0].trim(), rest: script.slice(m[0].length).trim() };
}

/** Deterministic, so the boxes can tell their own edits from changes made elsewhere. */
export const joinHook = (hook: string, rest: string) => (rest.trim() ? `${hook.replace(/\s+$/, "")} ${rest.trim()}` : hook);
const ENDS_SENTENCE = /[.!?…]["»“”']?\s*$/;

/**
 * Hook and body as the user wrote them. Kept as local state while typing: an unfinished hook has
 * no full stop yet, so re-splitting the script would swallow the body. Only an outside change to
 * the script (main editor, history, versions) resyncs the parts.
 */
export function useHookParts(script: string, setScript: (s: string) => void) {
  const [parts, setParts] = useState(() => splitHook(script));
  useEffect(() => {
    if (joinHook(parts.hook, parts.rest) !== script) setParts(splitHook(script));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script]);
  const edit = (next: HookParts) => { setParts(next); setScript(joinHook(next.hook, next.rest)); };
  return [parts, edit] as const;
}

/** Hook = what the presenter says on screen; the body plays over B-roll in the same HeyGen voice. */
export function HookSection({ parts, onChange, speed }: { parts: HookParts; onChange: (p: HookParts) => void; speed: number }) {
  const { hook, rest } = parts;
  return (
    <Section title="Hook and B-roll" description="The presenter is on screen for the hook. When it ends, B-roll takes over while the same HeyGen voice speaks the body.">
      <div>
        <Label htmlFor="hook-text" hint={hook.trim() ? `≈ ${spokenSeconds(hook, speed).toFixed(1)} s` : undefined}>Hook — presenter on screen</Label>
        <Textarea
          id="hook-text"
          lang="de"
          rows={2}
          spellCheck={false}
          value={hook}
          placeholder="Erster Satz: der Hook, den der Presenter spricht."
          onChange={(e) => onChange({ hook: e.target.value.replace(/\s*\n\s*/g, " "), rest })}
        />
        {hook.trim() && rest.trim() && !ENDS_SENTENCE.test(hook)
          ? <Hint className="text-warning">End the hook with . ! or ? so the presenter hands over to B-roll there.</Hint>
          : <Hint>The presenter hands over to B-roll exactly where the hook ends, timed from the real HeyGen voice.</Hint>}
      </div>
      <div>
        <Label htmlFor="rest-text" hint={rest.trim() ? `≈ ${spokenSeconds(rest, speed).toFixed(1)} s` : undefined}>After the hook — over B-roll</Label>
        <Textarea
          id="rest-text"
          lang="de"
          rows={4}
          spellCheck={false}
          value={rest}
          placeholder="Der Rest des Skripts, gesprochen über B-Roll."
          onChange={(e) => onChange({ hook, rest: e.target.value })}
        />
      </div>
    </Section>
  );
}
