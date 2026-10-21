import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Bot, Clock, History } from "lucide-react";
import { cn, relativeTime, splitSentences, spokenSeconds, wordCount } from "@/lib/format";
import { readScriptHistory } from "@/lib/prefs";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Badge, Hint, Input, Label, Section } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/tooltip";
import { useStudio } from "../studio-context";

const TARGET = { min: 20, max: 30 };

export function ScriptPanel() {
  const { project, draft } = useStudio();
  const navigate = useNavigate();
  const d = draft.draft!;
  const script = d.scriptDe ?? "";
  const area = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState(() => readScriptHistory(project.id));

  // Grow with the content so the whole script is visible without an inner scrollbar.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(220, el.scrollHeight + 2)}px`;
  }, [script]);

  useEffect(() => { if (draft.saveState === "saved") setHistory(readScriptHistory(project.id)); }, [draft.saveState, project.id]);

  const seconds = spokenSeconds(script, d.outputSpeed ?? 1);
  const inRange = seconds >= TARGET.min && seconds <= TARGET.max;
  const sentences = splitSentences(script);
  const segments = sentences.length >= 3
    ? [
        { label: "Hook", text: sentences[0] },
        { label: "Body", text: sentences.slice(1, -1).join(" ") },
        { label: "CTA", text: sentences[sentences.length - 1] },
      ]
    : [];

  return (
    <>
      <Section title="Project">
        <div>
          <Label htmlFor="project-title">Name</Label>
          <Input id="project-title" value={d.title} onChange={(e) => draft.update({ title: e.target.value })} placeholder="Untitled video" />
        </div>
      </Section>

      <Section
        title="German script"
        description="Spoken by the voice and used for captions."
        actions={
          <Menu
            className="w-80"
            trigger={<Button size="sm" variant="ghost" disabled={!history.length} aria-label="Script history"><History /> History</Button>}
            items={history.map((h) => ({
              label: relativeTime(h.at),
              description: h.text.slice(0, 90) + (h.text.length > 90 ? "…" : ""),
              onSelect: () => draft.update({ scriptDe: h.text }),
            }))}
          />
        }
      >
        <div>
          <label htmlFor="script" className="sr-only">German script</label>
          <textarea
            id="script"
            ref={area}
            value={script}
            onChange={(e) => draft.update({ scriptDe: e.target.value })}
            spellCheck={false}
            lang="de"
            placeholder="Schreib hier dein deutsches Skript…"
            className="w-full resize-none rounded-md border border-line bg-surface px-3.5 py-3 text-base leading-7 text-fg shadow-xs transition-[border-color,box-shadow] outline-none hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:bg-subtle"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="tabular">{wordCount(script)} words</span>
            <span aria-hidden>·</span>
            <span className="tabular">{script.length} characters</span>
            <span className="ml-auto">
              <Tip content={`Meta video ads perform best at ${TARGET.min}–${TARGET.max} s. Estimate at ~2.4 words/s${(d.outputSpeed ?? 1) !== 1 ? ` and ${d.outputSpeed}× export speed` : ""}.`}>
                <span tabIndex={0}>
                  <Badge tone={!script.trim() ? "neutral" : inRange ? "success" : "warning"}>
                    <Clock className="size-3" aria-hidden /> ≈ {Math.round(seconds)} s spoken
                  </Badge>
                </span>
              </Tip>
            </span>
          </div>
          {script.trim() && !inRange && (
            <Hint className="text-warning">
              {seconds < TARGET.min ? `About ${Math.round(TARGET.min - seconds)} s short of the ${TARGET.min}–${TARGET.max} s target.` : `About ${Math.round(seconds - TARGET.max)} s over the ${TARGET.min}–${TARGET.max} s target.`}
            </Hint>
          )}
        </div>
      </Section>

      {segments.length > 0 && (
        <Section title="Structure" description="How the script reads as an ad. Estimated from sentence order.">
          <ol className="space-y-2">
            {segments.map((s) => (
              <li key={s.label} className="rounded-lg border border-line bg-bg p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("text-xs font-semibold", s.label === "Hook" ? "text-accent" : s.label === "CTA" ? "text-success" : "text-fg-secondary")}>{s.label}</span>
                  <span className="tabular text-xs text-fg-muted">≈ {spokenSeconds(s.text, d.outputSpeed ?? 1).toFixed(1)} s</span>
                </div>
                <p className="line-clamp-3 text-sm text-fg-secondary">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Need a better script?" description="Send this script to the Agent with your notes; it writes a revised German version.">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => navigate(`/agent?brief=${encodeURIComponent(`Bitte verbessere dieses Skript für eine ${TARGET.min}–${TARGET.max}-sekündige Meta-Videoanzeige:\n\n${script}`)}`)}
        >
          <Bot /> Improve with the Agent
        </Button>
      </Section>
    </>
  );
}
