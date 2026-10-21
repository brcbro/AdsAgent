import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { ArrowDown, Bot, Check, Copy, UserRound } from "lucide-react";
import { cn, dateTime, relativeTime } from "@/lib/format";
import { copyText } from "@/lib/hooks";
import type { AgentJob, AgentMessage, AgentSession } from "@/lib/types";
import { Button } from "@/components/ui/button";

/*
 * Chat history. It only follows new messages while the reader is already at the bottom, so
 * scrolling up to read is never interrupted by polling.
 */
export function ChatThread({ session, jobs, busy }: { session?: AgentSession; jobs: AgentJob[]; busy: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const count = session?.messages.length ?? 0;
  const lastCount = useRef(count);
  const activeJob = jobs.find((j) => j.status === "running" || j.status === "queued");

  const scrollToBottom = (smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // New conversation: start at the bottom.
  useLayoutEffect(() => { atBottom.current = true; scrollToBottom(); lastCount.current = count; }, [session?.id]);

  useLayoutEffect(() => {
    const grew = count > lastCount.current;
    lastCount.current = count;
    if (atBottom.current) scrollToBottom(grew);
    else if (grew) setShowJump(true);
  }, [count, busy]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (atBottom.current) setShowJump(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} className="h-full overflow-y-auto" role="log" aria-live="polite" aria-label="Messages">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
          {!count ? <Welcome /> : session!.messages.map((m, i) => <Message key={`${m.at}-${i}`} message={m} />)}
          {busy && <Thinking stage={activeJob?.status === "queued" ? "Queued — waiting for the worker" : stageLabel(activeJob?.stage)} />}
        </div>
      </div>
      {showJump && (
        <Button size="sm" variant="secondary" className="absolute bottom-4 left-1/2 -translate-x-1/2 shadow-md" onClick={() => { scrollToBottom(true); setShowJump(false); }}>
          <ArrowDown /> New messages
        </Button>
      )}
    </div>
  );
}

function stageLabel(stage?: AgentJob["stage"]): string {
  switch (stage) {
    case "script": return "Writing the German script";
    case "voice": return "Generating narration";
    case "avatar": return "Animating the HeyGen presenter";
    case "render": return "Rendering the video";
    case "quality": return "Checking video quality";
    default: return "Working";
  }
}

function Message({ message }: { message: AgentMessage }) {
  const user = message.role === "user";
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("group flex gap-3", user && "flex-row-reverse")}>
      <div className={cn("grid size-8 shrink-0 place-items-center rounded-full", user ? "bg-subtle text-fg-secondary" : "bg-accent text-accent-fg")} aria-hidden>
        {user ? <UserRound className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className={cn("flex max-w-[85%] min-w-0 flex-col", user && "items-end")}>
        <div className="mb-1 flex items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg-secondary">{user ? "You" : "Video Agent"}</span>
          <time dateTime={message.at} title={dateTime(message.at)}>{relativeTime(message.at)}</time>
        </div>
        <div className={cn(
          "rounded-2xl px-4 py-3 text-base leading-relaxed",
          user ? "rounded-tr-md bg-accent text-accent-fg" : "rounded-tl-md border border-line bg-surface text-fg shadow-xs",
        )}>
          {user
            ? <p className="whitespace-pre-wrap break-words">{message.text}</p>
            : <div className="prose-chat break-words"><Markdown>{message.text}</Markdown></div>}
        </div>
        <button
          type="button"
          onClick={async () => { if (await copyText(message.text)) { setCopied(true); toast.success("Copied"); setTimeout(() => setCopied(false), 1500); } }}
          className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} Copy
        </button>
      </div>
    </div>
  );
}

function Thinking({ stage }: { stage: string }) {
  return (
    <div className="flex gap-3" role="status">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg" aria-hidden><Bot className="size-4" /></div>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-xs">
        <span className="flex gap-1" aria-hidden>
          {[0, 160, 320].map((d) => <span key={d} className="size-1.5 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: `${d}ms` }} />)}
        </span>
        <span className="text-sm text-fg-secondary">{stage}…</span>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="mx-auto max-w-xl py-10 text-center animate-fade-in">
      <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-accent-subtle text-accent"><Bot className="size-7" /></div>
      <h2 className="text-2xl font-semibold tracking-tight text-fg">Your German video assistant</h2>
      <p className="mt-3 text-base text-fg-muted">
        Describe the audience, topic, tone and call to action. The agent writes the script, creates German narration,
        selects B-roll and runs technical checks on the finished video.
      </p>
      <div className="mt-6 grid gap-2 text-left text-sm sm:grid-cols-3">
        {[["1", "Brief", "Tell it what you need"], ["2", "Script", "Review or auto-produce"], ["3", "Video", "Checked and ready to approve"]].map(([n, t, d]) => (
          <div key={n} className="rounded-lg border border-line bg-surface p-3 shadow-xs">
            <div className="text-xs font-semibold text-accent">Step {n}</div>
            <div className="mt-1 font-medium text-fg">{t}</div>
            <div className="text-xs text-fg-muted">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
