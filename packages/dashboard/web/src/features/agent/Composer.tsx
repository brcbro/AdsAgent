import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Info, Sparkles } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { keys, useAvatars, useStudioConfig, useSuggestions } from "@/lib/queries";
import { useDebounced } from "@/lib/hooks";
import type { HeyGenAvatar, Suggestion } from "@/lib/types";
import { Button, DisabledReason } from "@/components/ui/button";
import { Kbd, Segmented, Select, Switch } from "@/components/ui/primitives";
import { Tip } from "@/components/ui/tooltip";

const MAX = 4000;
const DURATIONS = ["10", "20", "30", "45"] as const;
const SUGGESTIONS = [
  "Create a 20-second German video about disciplined trading. Calm and educational, end with an invitation to learn more.",
  "Write a punchy 30-second ad about FOMO in trading for beginners, with a strong hook in the first sentence.",
  "Make a 20-second video explaining risk management in three simple rules.",
];

export function Composer({ sessionId, busy, hasMessages }: { sessionId: string; busy: boolean; hasMessages: boolean }) {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>("20");
  const [auto, setAuto] = useState(true);
  const [sending, setSending] = useState(false);
  const [productionMode, setProductionMode] = useState<"local" | "heygen">("local");
  const [presenterSearch, setPresenterSearch] = useState("");
  const [presenter, setPresenter] = useState<HeyGenAvatar | null>(null);
  const config = useStudioConfig();
  const query = useDebounced(presenterSearch, 250);
  const avatars = useAvatars({ page: 1, q: query }, productionMode === "heygen");
  const selectedPresenter = presenter ?? config.data?.defaultAvatar;
  const area = useRef<HTMLTextAreaElement>(null);

  // Prefill from "Improve with the Agent" in the Studio (?brief=…), then clean the URL.
  useEffect(() => {
    const brief = params.get("brief");
    if (brief) {
      setText(brief.slice(0, MAX));
      setAuto(false);
      params.delete("brief");
      setParams(params, { replace: true });
      area.current?.focus();
    }
  }, [params, setParams]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(220, Math.max(56, el.scrollHeight))}px`;
  }, [text]);

  const reason = busy ? "Wait for the current job in this chat to finish"
    : productionMode === "heygen" && !config.data?.services?.avatar ? "HeyGen isn't configured — see Settings"
    : productionMode === "heygen" && !selectedPresenter ? "Choose a HeyGen presenter first" : null;

  async function send() {
    const message = text.trim();
    if (!message || reason || sending) return;
    setSending(true);
    try {
      await api.sendBrief(sessionId, { message, targetSeconds: Number(duration), autoProduce: auto,
        productionMode, ...(productionMode === "heygen" ? { avatarId: selectedPresenter!.avatar_id } : {}) });
      setText("");
      toast.success("Brief queued", { description: "You can leave this page while the agent works — progress is saved." });
      await client.invalidateQueries({ queryKey: keys.agent });
    } catch (err) {
      toast.error("Couldn't send the brief", { description: errorMessage(err) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented<"local" | "heygen"> label="Video type" size="sm" value={productionMode} onChange={setProductionMode}
            options={[{ value: "local", label: "Local preview" }, { value: "heygen", label: "HeyGen avatar" }]} />
          {productionMode === "heygen" && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input aria-label="Search presenters" placeholder="Search presenters…" value={presenterSearch} onChange={e => setPresenterSearch(e.target.value)}
              className="h-8 min-w-32 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-fg" />
            <Select aria-label="Presenter" className="h-8 min-w-40 flex-1 text-xs" value={selectedPresenter?.avatar_id ?? ""}
              onChange={e => setPresenter(avatars.data?.avatars.find(a => a.avatar_id === e.target.value) ?? config.data?.defaultAvatar ?? null)}>
              {!selectedPresenter && <option value="">Choose a presenter</option>}
              {selectedPresenter && <option value={selectedPresenter.avatar_id}>{selectedPresenter.avatar_name}</option>}
              {(avatars.data?.avatars ?? []).filter(a => a.avatar_id !== selectedPresenter?.avatar_id).map(a => <option key={a.avatar_id} value={a.avatar_id}>{a.avatar_name}</option>)}
            </Select>
            {avatars.isError && <span className="text-xs text-danger">Presenter list unavailable. Refresh the page.</span>}
          </div>}
        </div>
        {!hasMessages && !text && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => { setText(s); area.current?.focus(); }}
                className="max-w-full truncate rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-fg-secondary shadow-xs transition-colors hover:border-line-strong hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="rounded-xl border border-line bg-surface shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
        >
          <SuggestedHooks onPick={(line) => { setText((t) => (t.trim() ? `${t.trimEnd()}\n${line}` : line).slice(0, MAX)); area.current?.focus(); }} />
          <label htmlFor="agent-brief" className="sr-only">Brief for the agent</label>
          <textarea
            id="agent-brief"
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
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-muted">Length</span>
              <Segmented label="Target duration" size="sm" value={duration} onChange={setDuration}
                options={DURATIONS.map((d) => ({ value: d, label: `${d}s` }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="agent-auto" checked={auto} onCheckedChange={setAuto} />
              <label htmlFor="agent-auto" className="cursor-pointer text-xs font-medium text-fg-secondary">Auto-produce video</label>
              <Tip content="On: the agent writes the script and produces the video in one go. Off: it stops after the script so you can review and edit it first.">
                <button type="button" aria-label="About auto-produce" className="text-fg-muted hover:text-fg"><Info className="size-3.5" /></button>
              </Tip>
            </div>
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
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-xs text-fg-muted">
          <span>{productionMode === "heygen" ? "ElevenLabs German voice → HeyGen v3 presenter → B-roll, captions and music. Auto-produce uses ElevenLabs and HeyGen credits." : "Claude script · ElevenLabs German voice · local B-roll. New scripts and voices use API credits."}</span>
          <span className="hidden items-center gap-1 sm:inline-flex"><Kbd>Enter</Kbd> send <span className="ml-1.5"><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd></span> new line</span>
        </div>
      </div>
    </div>
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
