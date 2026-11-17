import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Check, ChevronDown, Clock, FileCheck2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { keys, useAvatarVoice, useStudioConfig } from "@/lib/queries";
import { useMediaQuery } from "@/lib/hooks";
import { usePref, type SavedAvatar } from "@/lib/prefs";
import { Button, DisabledReason } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { PresenterPicker, toSaved } from "./PresenterPicker";
import { voiceModelLabel } from "../studio/AvatarVoice";
import { BRIEF_INPUT_ID, BRIEF_MAX as MAX, appendToBrief, setBriefDraft } from "./brief-draft";
import { Ideas } from "./Ideas";

export { BRIEF_INPUT_ID };
const DURATIONS = ["10", "20", "30", "45"] as const;

/** Small pill buttons under the text: presenter, length, review. Everything else lives behind them. */
const CHIP = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-line-strong hover:text-fg [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * The brief box: a text field and one row of chips (presenter, length, review first) with a round
 * Send button. Settings and the unsent text are kept in prefs, so they survive switching chats
 * and reloading the page.
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
  const setText = (v: string | ((t: string) => string)) => setBriefDraft(sessionId, v);
  const patch = (p: Partial<typeof composer>) => setComposer({ ...composer, ...p });

  // Every video is a HeyGen presenter speaking in its own voice; local previews were retired.
  const { duration, auto } = composer;
  const defaultPresenter: SavedAvatar | null = config.data?.defaultAvatar ? toSaved(config.data.defaultAvatar) : null;
  const presenter = composer.presenter ?? defaultPresenter;
  const avatarVoice = useAvatarVoice(presenter?.id);
  const voiceName = avatarVoice.data?.voice?.name;

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
    : !config.data?.services?.avatar ? "HeyGen isn't configured — see Settings"
    : !presenter ? "Choose a HeyGen presenter first" : null;

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
        productionMode: "heygen", avatarId: presenter!.id });
      setText("");
      toast.success("Brief queued", { description: "You can leave this page while the agent works — progress is saved." });
      await Promise.all([client.invalidateQueries({ queryKey: keys.agent }), client.invalidateQueries({ queryKey: keys.agentSession(sessionId) })]);
    } catch (err) {
      toast.error("Couldn't send the brief", { description: errorMessage(err) });
    } finally {
      setSending(false);
    }
  }

  const review = !auto;

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-3 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="rounded-2xl border border-line bg-surface shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
        >
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
            className="block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed text-fg outline-none placeholder:text-fg-muted"
          />
          <div className="flex items-center gap-2 px-3 pt-1 pb-2.5">
            {/* One row on larger screens; on a phone the chips wrap to a second line so none is hidden. */}
            <div role="group" aria-label="Video options" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-0.5 sm:flex-nowrap sm:overflow-x-auto sm:[scrollbar-width:none]">
              <PresenterPicker
                chip
                value={presenter}
                onChange={(a) => patch({ presenter: a })}
                footer={presenter && (
                  <span data-testid="presenter-voice">
                    Voice: {avatarVoice.isPending ? "loading…" : voiceName ? `${voiceName} (avatar's own)` : "avatar's default"} · {voiceModelLabel(avatarVoice.data?.voiceModel)}
                  </span>
                )}
              />
              <Menu
                align="start"
                className="min-w-36"
                trigger={<button type="button" className={CHIP} aria-label={`Video length: ${duration} seconds`}><Clock aria-hidden />{duration} s<ChevronDown aria-hidden className="text-fg-muted" /></button>}
                items={DURATIONS.map((d) => ({
                  label: `${d} seconds`,
                  icon: d === duration ? <Check /> : <span className="size-4" aria-hidden />,
                  onSelect: () => patch({ duration: d }),
                }))}
              />
              <Tip content={review
                ? "On: it stops after the script so you can edit it before any credits are spent."
                : "Off: it writes the script and makes the video in one go, using credits."}>
                <button type="button" aria-pressed={review} aria-label="Review script first" onClick={() => patch({ auto: !auto })}
                  className={cn(CHIP, review && "border-accent bg-accent-subtle text-accent hover:text-accent")}>
                  <FileCheck2 aria-hidden />Review script first
                </button>
              </Tip>
            </div>
            <Ideas onPick={(line) => { appendToBrief(sessionId, line); area.current?.focus(); }} />
            {text.length > MAX * 0.8 && (
              <span className={cn("tabular text-xs", text.length > MAX * 0.9 ? "text-warning" : "text-fg-muted")}>{text.length}/{MAX}</span>
            )}
            <DisabledReason reason={reason}>
              <Tip content="Send. Uses HeyGen credits when it makes the video." shortcut="Enter">
                <Button type="submit" variant="primary" size="icon" className="rounded-full" loading={sending}
                  disabled={!!reason || !text.trim()} aria-label="Send brief">
                  {sending ? null : <ArrowUp />}
                </Button>
              </Tip>
            </DisabledReason>
          </div>
        </form>
      </div>
    </div>
  );
}
