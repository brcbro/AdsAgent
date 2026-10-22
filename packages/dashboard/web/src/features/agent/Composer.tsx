import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { ArrowUp, Info, SlidersHorizontal, Sparkles } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { keys, useStudioConfig, useSuggestions } from "@/lib/queries";
import { useMediaQuery } from "@/lib/hooks";
import { setPrefs, usePref, type SavedAvatar } from "@/lib/prefs";
import type { Suggestion } from "@/lib/types";
import { Button, DisabledReason } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Kbd, Segmented, Switch } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/tooltip";
import { PresenterPicker, toSaved } from "./PresenterPicker";

export const BRIEF_INPUT_ID = "agent-brief";
const MAX = 4000;
const DURATIONS = ["10", "20", "30", "45"] as const;
const SUGGESTIONS = [
  "Create a 20-second German video about disciplined trading. Calm and educational, end with an invitation to learn more.",
  "Write a punchy 30-second ad about FOMO in trading for beginners, with a strong hook in the first sentence.",
  "Make a 20-second video explaining risk management in three simple rules.",
];

/**
 * The brief box. Settings (video type, presenter, length, auto-produce) and the unsent text are
 * kept in prefs, so they survive switching chats and reloading the page.
 */
export function Composer({ sessionId, busy, hasMessages, reviewPending }:
  { sessionId: string; busy: boolean; hasMessages: boolean; reviewPending: boolean }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [composer, setComposer] = usePref("agentComposer");
  const [drafts] = usePref("agentDrafts");
  const [sending, setSending] = useState(false);
  const config = useStudioConfig();
  const wide = useMediaQuery("(min-width: 640px)");
  const area = useRef<HTMLTextAreaElement>(null);

  const text = drafts[sessionId] ?? "";
  const setText = useCallback((v: string | ((t: string) => string)) => setPrefs((p) => {
    const current = p.agentDrafts[sessionId] ?? "";
    const value = (typeof v === "function" ? v(current) : v).slice(0, MAX);
    const next = { ...p.agentDrafts };
    if (value) next[sessionId] = value; else delete next[sessionId];
    return { agentDrafts: next };
  }), [sessionId]);
  const patch = (p: Partial<typeof composer>) => setComposer({ ...composer, ...p });

  const { productionMode, duration, auto } = composer;
  const defaultPresenter: SavedAvatar | null = config.data?.defaultAvatar ? toSaved(config.data.defaultAvatar) : null;
  const presenter = composer.presenter ?? defaultPresenter;

  // Prefill from "Improve with the Agent" in the Studio (?brief=…), then clean the URL.
  useEffect(() => {
    const brief = params.get("brief");
    if (brief) {
      setText(brief);
      patch({ auto: false });
      params.delete("brief");
      setParams(params, { replace: true });
      area.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(wide ? 220 : 120, Math.max(56, el.scrollHeight))}px`;
  }, [text, wide]);

  const reason = busy ? "Wait for the current job in this chat to finish"
    : productionMode === "heygen" && !config.data?.services?.avatar ? "HeyGen isn't configured — see Settings"
    : productionMode === "heygen" && !presenter ? "Choose a HeyGen presenter first" : null;

  async function send() {
    const message = text.trim();
    if (!message || reason || sending) return;
    if (reviewPending && !(await confirm({
      title: "Replace the script awaiting review?",
      description: "The script in the review panel is discarded and this brief starts a new one. To keep it, approve or revise it there instead.",
      confirmLabel: "Send and replace", cancelLabel: "Keep the script",
    }))) return;
    setSending(true);
    try {
      await api.sendBrief(sessionId, { message, targetSeconds: Number(duration), autoProduce: auto,
        productionMode, ...(productionMode === "heygen" ? { avatarId: presenter!.id } : {}) });
      setText("");
      toast.success("Brief queued", { description: "You can leave this page while the agent works — progress is saved." });
      await Promise.all([client.invalidateQueries({ queryKey: keys.agent }), client.invalidateQueries({ queryKey: keys.agentSession(sessionId) })]);
    } catch (err) {
      toast.error("Couldn't send the brief", { description: errorMessage(err) });
    } finally {
      setSending(false);
    }
  }

  const modeControl = (
    <Segmented<"local" | "heygen"> label="Video type" size="sm" value={productionMode} onChange={(v) => patch({ productionMode: v })}
      options={[{ value: "local", label: "Local preview" }, { value: "heygen", label: "HeyGen avatar" }]} />
  );
  const presenterControl = productionMode === "heygen" && (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <PresenterPicker value={presenter} onChange={(a) => patch({ presenter: a })} className="min-w-44 flex-1" />
    </div>
  );
  const lengthControl = (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-fg-muted">Length</span>
      <Segmented label="Target duration" size="sm" value={duration} onChange={(v) => patch({ duration: v })}
        options={DURATIONS.map((d) => ({ value: d, label: `${d}s` }))} />
    </div>
  );
  const autoControl = (
    <div className="flex items-center gap-2">
      <Switch id="agent-auto" checked={auto} onCheckedChange={(v) => patch({ auto: v })} />
      <label htmlFor="agent-auto" className="cursor-pointer text-xs font-medium text-fg-secondary">Auto-produce video</label>
      <Tip content="On: the agent writes the script and produces the video in one go. Off: it stops after the script so you can review and edit it before any credits are spent.">
        <button type="button" aria-label="About auto-produce" className="text-fg-muted hover:text-fg"><Info className="size-3.5" /></button>
      </Tip>
    </div>
  );

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-3 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        {wide && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {modeControl}
            {presenterControl}
          </div>
        )}
        {!hasMessages && !text && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => { setText(s); area.current?.focus(); }} title={s}
                className="line-clamp-2 max-w-full rounded-2xl border border-line bg-surface px-3 py-1.5 text-left text-xs text-fg-secondary shadow-xs transition-colors hover:border-line-strong hover:text-fg sm:max-w-[48%]">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="rounded-xl border border-line bg-surface shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
        >
          <SuggestedHooks onPick={(line) => { setText((t) => (t.trim() ? `${t.trimEnd()}\n${line}` : line)); area.current?.focus(); }} />
          <label htmlFor={BRIEF_INPUT_ID} className="sr-only">Brief for the agent</label>
          <textarea
            id={BRIEF_INPUT_ID}
            ref={area}
            value={text}
            maxLength={MAX}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }}
            placeholder={hasMessages ? "Ask for a revision, or describe the next video…" : "Describe the German video you want to create…"}
            className="block w-full resize-none rounded-t-xl bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed text-fg outline-none placeholder:text-fg-muted"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-1 pb-2.5">
            {wide ? (
              <>
                {lengthControl}
                {autoControl}
              </>
            ) : (
              <OptionsPopover summary={`${productionMode === "heygen" ? presenter?.name ?? "HeyGen" : "Local"} · ${duration}s · ${auto ? "Auto" : "Review first"}`}>
                {modeControl}
                {presenterControl}
                {lengthControl}
                {autoControl}
              </OptionsPopover>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className={cn("tabular text-xs", text.length > MAX * 0.9 ? "text-warning" : "text-fg-muted")}>{text.length}/{MAX}</span>
              <DisabledReason reason={reason}>
                <Button type="submit" variant="primary" size="sm" loading={sending} disabled={!!reason || !text.trim()} aria-label="Send brief">
                  <ArrowUp /> Send
                </Button>
              </DisabledReason>
            </div>
          </div>
        </form>
        <div className="mt-2 hidden flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-xs text-fg-muted sm:flex">
          <span>{productionMode === "heygen" ? "ElevenLabs German voice → HeyGen v3 presenter → B-roll, captions and music. Auto-produce uses ElevenLabs and HeyGen credits." : "Claude script · ElevenLabs German voice · local B-roll. New scripts and voices use API credits."}</span>
          <span className="inline-flex items-center gap-1"><Kbd>Enter</Kbd> send <span className="ml-1.5"><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd></span> new line</span>
        </div>
      </div>
    </div>
  );
}

/** On phones the settings fold into one button so the thread keeps its space. */
function OptionsPopover({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" className="max-w-[60vw] px-2" aria-label="Brief options"><SlidersHorizontal /><span className="truncate text-xs">{summary}</span></Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-[min(92vw,22rem)] space-y-3 rounded-lg border border-line bg-surface p-3 shadow-lg animate-fade-in">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Data-backed ideas from the Winning patterns; a click appends the idea to the brief so the agent builds on it. */
function SuggestedHooks({ onPick }: { onPick: (line: string) => void }) {
  const q = useSuggestions({ kind: ["hook", "angle", "cta"], status: ["open", "accepted"] });
  const list = (q.data?.suggestions ?? []).slice(0, 5);
  if (!list.length) return null;
  const line = (s: Suggestion) => `${s.kind === "hook" ? "Hook idea" : s.kind === "angle" ? "Angle" : "CTA"}: ${s.title.replace(/^(Open with a|Lead with the|Close with a)\s/, "")} — ${s.body}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2" data-testid="suggested-hooks" aria-label="Suggested from winning ads">
      <Sparkles className="size-3.5 text-accent" aria-hidden />
      <span className="mr-1 text-xs text-fg-muted">From winning ads:</span>
      {list.map((s) => (
        <button key={s.id} type="button" onClick={() => onPick(line(s))} title={s.rationale}
          className="press inline-flex h-7 items-center gap-1 rounded-full border border-line bg-subtle px-2.5 text-xs font-medium text-fg-secondary transition-colors hover:border-accent hover:text-fg">
          <span className="text-fg-muted">{s.kind === "hook" ? "Hook" : s.kind === "angle" ? "Angle" : "CTA"}</span> {s.title.replace(/^(Open with a|Lead with the|Close with a)\s/, "").replace(/\s(hook|angle|CTA)$/, "")}
        </button>
      ))}
    </div>
  );
}
