import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { toast } from "sonner";
import { ArrowDown, Bot, Check, Copy, UserRound } from "lucide-react";
import { cn, dateTime, elapsed, relativeTime } from "@/lib/format";
import { copyText, useNow } from "@/lib/hooks";
import type { AgentJob, AgentMessage, AgentSession } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { jobFlags } from "./JobActions";
import { JobResultCard } from "./JobResultCard";

/*
 * Chat history. It only follows new messages while the reader is already at the bottom, so
 * scrolling up to read is never interrupted by polling. Finished and failed jobs appear inline,
 * right after the message the agent wrote about them.
 */
export function ChatThread({ session, jobs, busy }: { session?: AgentSession; jobs: AgentJob[]; busy: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const messages = session?.messages ?? [];
  const activeJob = jobs.find((j) => j.status === "running" || j.status === "queued");

  // Cards go after the last message written up to a few seconds after the job's final checkpoint.
  const cardsAfter = useMemo(() => {
    const map = new Map<number, AgentJob[]>();
    for (const job of jobs) {
      const f = jobFlags(job);
      const show = (job.status === "done" && f.hasVideo) || job.status === "needs_review" || job.status === "error" || (job.status === "canceled" && f.hasVideo);
      if (!show) continue;
      const limit = new Date(job.updatedAt).getTime() + 3_000;
      let index = 0;
      for (let i = 0; i < messages.length; i++) if (new Date(messages[i].at).getTime() <= limit) index = i + 1;
      map.set(index, [...(map.get(index) ?? []), job]);
    }
    return map;
  }, [jobs, messages]);

  const count = messages.length + jobs.length;
  const lastCount = useRef(count);

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

  const items: ReactNode[] = [];
  for (const job of cardsAfter.get(0) ?? []) items.push(<JobResultCard key={job.id} job={job} />);
  messages.forEach((m, i) => {
    items.push(<Message key={`${m.at}-${i}`} message={m} />);
    for (const job of cardsAfter.get(i + 1) ?? []) items.push(<JobResultCard key={job.id} job={job} />);
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} className="h-full overflow-y-auto" role="log" aria-live="polite" aria-label="Messages">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
          {!messages.length ? <Welcome /> : items}
          {busy && <Thinking job={activeJob} />}
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
        {/* Always visible on touch screens, where there is no hover to reveal it. */}
        <button
          type="button"
          onClick={async () => { if (await copyText(message.text)) { setCopied(true); toast.success("Copied"); setTimeout(() => setCopied(false), 1500); } }}
          className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted transition-opacity hover:text-fg focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} Copy
        </button>
      </div>
    </div>
  );
}

/** The worker's latest checkpoint text and how long the job has been running, not just a generic stage name. */
function Thinking({ job }: { job?: AgentJob }) {
  const now = useNow(1_000);
  const queued = job?.status === "queued";
  const last = job?.events[job.events.length - 1];
  const headline = queued ? "Queued — waiting for the worker" : stageLabel(job?.stage);
  const detail = !queued && last && !/^Worker started|^Brief saved/.test(last.text) ? last.text : undefined;
  const since = job?.events.find((e) => /^Worker started|^Resuming/.test(e.text))?.at ?? job?.updatedAt;
  return (
    <div className="flex gap-3" role="status">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg" aria-hidden><Bot className="size-4" /></div>
      <div className="flex max-w-[85%] items-start gap-3 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-xs">
        <span className="mt-1.5 flex gap-1" aria-hidden>
          {[0, 160, 320].map((d) => <span key={d} className="size-1.5 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: `${d}ms` }} />)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-fg-secondary">
            <span>{headline}…</span>
            {!queued && since && <span className="tabular text-xs text-fg-muted">{elapsed(since, now)}</span>}
          </div>
          {detail && <p className="mt-0.5 text-xs text-fg-muted [overflow-wrap:anywhere]">{detail}</p>}
        </div>
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
        {[["1", "Brief", "Tell it what you need"], ["2", "Script", "Review and edit before any credits are spent"], ["3", "Video", "Checked and ready to approve"]].map(([n, t, d]) => (
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
