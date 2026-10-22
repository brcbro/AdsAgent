import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clapperboard, FileEdit, MessageSquare, MessageSquareWarning, RotateCw, X, XCircle } from "lucide-react";
import { api, errorMessage, videoUrl } from "@/lib/api";
import { cn, dateTime, JOB_STATUS, relativeTime, truncateWords } from "@/lib/format";
import { usePref } from "@/lib/prefs";
import { useWorkerInfo } from "@/lib/queries";
import type { AgentJob, AgentSessionSummary, JobStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, KeyValue, Segmented, Select } from "@/components/ui/primitives";
import { useJobActions } from "./JobActions";
import { StageStepper } from "./StageStepper";

type Scope = "chat" | "all";
const PAGE = 50;
const RANK: Record<JobStatus, number> = { running: 0, script_review: 1, queued: 2, needs_review: 3, error: 3, done: 3, canceled: 3 };

export function JobQueue({ jobs, totalJobs, sessionId, liveSessions, workerRunning }: {
  jobs: AgentJob[]; totalJobs: number; sessionId?: string; liveSessions: AgentSessionSummary[]; workerRunning: boolean;
}) {
  const [scope, setScope] = useState<Scope>("chat");
  const [status, setStatus] = useState<"" | JobStatus>("");
  const [older, setOlder] = useState<AgentJob[]>([]);
  const [chatTotal, setChatTotal] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  // Older pages loaded on demand sit behind the live list; live rows win when both carry a job.
  const known = useMemo(() => {
    const seen = new Set(jobs.map((j) => j.id));
    return [...jobs, ...older.filter((j) => !seen.has(j.id))];
  }, [jobs, older]);
  const inScope = known.filter((j) => scope === "all" || j.sessionId === sessionId);
  const list = inScope
    .filter((j) => !status || j.status === status)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt.localeCompare(a.createdAt));
  const chatKnown = sessionId ? chatTotal[sessionId] : undefined;
  const total: number = scope === "all" ? totalJobs : chatKnown ?? (inScope.length >= PAGE ? Infinity : inScope.length);
  const hasMore = inScope.length < total;

  async function loadOlder() {
    setLoading(true);
    try {
      const res = await api.agentJobs({ sessionId: scope === "chat" ? sessionId : undefined, offset: inScope.length, limit: PAGE });
      setOlder((prev) => [...prev, ...res.jobs]);
      if (scope === "chat" && sessionId) setChatTotal((t) => ({ ...t, [sessionId]: res.total }));
    } catch (err) {
      toast.error("Couldn't load older jobs", { description: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  const empty = !jobs.length ? "Jobs appear here when you send a brief. Progress is saved through restarts."
    : !inScope.length && scope === "chat" ? "No jobs in this chat yet. Send a brief to start one."
    : "No jobs match these filters.";

  return (
    <aside className="flex h-full w-[360px] max-w-full shrink-0 flex-col border-l border-line bg-surface" aria-label="Job queue">
      <div className="space-y-3 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Job queue</h2>
          <WorkerStatus running={workerRunning} />
        </div>
        <div className="flex gap-2">
          <Segmented<Scope> label="Show jobs from" size="sm" value={scope} onChange={setScope}
            options={[{ value: "chat", label: "This chat" }, { value: "all", label: "All chats" }]} />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as JobStatus | "")} className="h-8 flex-1 text-xs">
            <option value="">Any status</option>
            {(Object.keys(JOB_STATUS) as JobStatus[]).map((s) => <option key={s} value={s}>{JOB_STATUS[s].label}</option>)}
          </Select>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!list.length && <p className="px-2 py-10 text-center text-sm text-fg-muted">{empty}</p>}
        {list.map((job) => (
          <JobCard key={job.id} job={job} current={job.sessionId === sessionId} chatArchived={!liveSessions.some((s) => s.id === job.sessionId)} />
        ))}
        {hasMore && !status && (
          <Button variant="secondary" className="w-full" loading={loading} onClick={loadOlder}>
            Show older jobs{Number.isFinite(total) ? ` (${total - inScope.length} more)` : ""}
          </Button>
        )}
      </div>
    </aside>
  );
}

/** Worker heartbeat; click for restarts, exit codes and the tail of worker.log. */
function WorkerStatus({ running }: { running: boolean }) {
  const [open, setOpen] = useState(false);
  const info = useWorkerInfo(open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded px-1 text-xs text-fg-muted hover:text-fg" title="Worker details and log">
        <span className={cn("size-2 rounded-full", running ? "bg-success" : "bg-warning animate-pulse-soft")} aria-hidden />
        {running ? "Worker online" : "Worker restarting"}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Agent worker" size="lg"
        description="The worker runs jobs in the background; the queue survives restarts. The dashboard restarts it within two seconds when it exits.">
        <KeyValue items={[
          { label: "Status", value: info.data ? (info.data.running ? "Running" : "Not running") : "…" },
          { label: "Started", value: info.data?.startedAt ? dateTime(info.data.startedAt) : "—" },
          { label: "Restarts since the dashboard started", value: info.data?.restarts ?? "—" },
          { label: "Last exit", value: info.data?.lastExit ? `${dateTime(info.data.lastExit)} (code ${info.data.lastExitCode ?? "signal"})` : "none" },
        ]} />
        <h3 className="mt-4 mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">worker.log (last lines)</h3>
        <pre className="max-h-[40vh] overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed text-fg-secondary whitespace-pre-wrap [overflow-wrap:anywhere]">
          {info.isError ? "Couldn't read the log." : info.data?.log.length ? info.data.log.join("\n") : "No output yet."}
        </pre>
      </Dialog>
    </>
  );
}

function JobCard({ job, current, chatArchived }: { job: AgentJob; current: boolean; chatArchived: boolean }) {
  const navigate = useNavigate();
  const [edits] = usePref("agentScriptEdits");
  const { flags, pending, approve, retry, reopen, cancel, requestChanges, rejectDialog } = useJobActions(job);
  const status = JOB_STATUS[job.status];
  const edited = edits[job.id] !== undefined && job.status === "script_review";
  const passed = job.quality?.checks.filter((c) => c.result === "pass").length ?? 0;
  const title = job.title || truncateWords(job.brief, 70);

  // A question answered in the chat: one quiet row, no stepper or attempts.
  if (flags.replyOnly) {
    return (
      <article className={cn("rounded-lg border bg-surface px-3 py-2 text-xs shadow-xs", current ? "border-line-strong" : "border-line")} data-testid="job-reply">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-fg">{title}</span>
          <span className="shrink-0 text-fg-muted" title={dateTime(job.updatedAt)}>{relativeTime(job.updatedAt)}</span>
        </div>
        <p className="mt-0.5 pl-5.5 text-fg-muted">Answered in the chat — no video was needed.{!current && !chatArchived && <> <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/agent/${job.sessionId}`)}>Open chat</button></>}</p>
      </article>
    );
  }

  return (
    <article className={cn("rounded-lg border bg-surface shadow-xs transition-colors", current ? "border-line-strong" : "border-line", job.approvedAt && "opacity-80")}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg [overflow-wrap:anywhere]">{title}</h3>
          <Badge tone={status.tone} dot pulse={job.status === "running"}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {job.productionMode === "heygen" ? `HeyGen · ${job.avatarName || "Presenter"} · ` : "Local · "}
          <span title={dateTime(job.createdAt)}>{relativeTime(job.createdAt)}</span> · {job.targetSeconds}s target · attempt {job.attempts}/3
          {edited && <> · <span className="text-warning">edited</span></>}
        </p>
        {job.approvedAt && (
          <p className="mt-1 text-xs font-medium text-success" title={dateTime(job.approvedAt)}>
            <Check className="mr-1 inline size-3.5" aria-hidden />Approved {relativeTime(job.approvedAt)}{job.approvedBy ? ` by ${job.approvedBy}` : ""}
          </p>
        )}
        {job.rejectedAt && !job.approvedAt && (
          <p className="mt-1 text-xs text-warning" title={dateTime(job.rejectedAt)}>
            <MessageSquareWarning className="mr-1 inline size-3.5" aria-hidden />Changes requested {relativeTime(job.rejectedAt)}
          </p>
        )}

        <StageStepper job={job} className="mt-3" />

        {job.error && (
          <div className="mt-3 flex gap-2 rounded-md bg-danger-subtle p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{job.error}</span>
          </div>
        )}
        {flags.outOfAttempts && <p className="mt-2 text-xs text-fg-muted">Three attempts used. Start a new brief to try a different approach.</p>}

        {job.quality && (
          <div className={cn("mt-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs", job.quality.passed ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning")}>
            {job.quality.passed ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
            <span className="font-medium">{passed}/{job.quality.checks.length} technical checks passed</span>
            <span className="ml-auto text-fg-muted">{job.quality.durationSeconds.toFixed(1)} s</span>
          </div>
        )}

        {job.quality && job.projectId && job.status === "done" && (
          <video src={videoUrl(job.projectId, job.updatedAt)} controls preload="none" playsInline
            className="mt-3 max-h-64 w-full rounded-md bg-stage" aria-label={`${job.title ?? "Agent"} video`} />
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.canApprove && <Button size="sm" variant="primary" loading={pending === "approve"} onClick={approve}><Check /> Approve</Button>}
          {flags.canApprove && <Button size="sm" variant="secondary" onClick={requestChanges}><MessageSquareWarning /> Request changes</Button>}
          {flags.hasProject && <Button size="sm" variant="secondary" onClick={() => navigate(`/studio/${job.projectId}`)}><Clapperboard /> Open in Studio</Button>}
          {flags.canEditScript && <Button size="sm" variant="secondary" loading={pending === "reopen"} onClick={reopen}><FileEdit /> Edit script</Button>}
          {flags.canRetry && <Button size="sm" variant="ghost" loading={pending === "retry"} onClick={retry}><RotateCw /> Retry</Button>}
          {!current && !chatArchived && <Button size="sm" variant="ghost" onClick={() => navigate(`/agent/${job.sessionId}`)}><MessageSquare /> Open chat</Button>}
          {chatArchived && <Badge>Chat archived</Badge>}
          {flags.active && <Button size="sm" variant="danger-ghost" className="ml-auto" loading={pending === "cancel"} onClick={cancel}><X /> Cancel</Button>}
        </div>
      </div>

      <div className="border-t border-line">
        {job.quality && (
          <Disclosure title="Quality report">
            <ul className="space-y-2">
              {job.quality.checks.map((c) => (
                <li key={c.name} className="flex gap-2 text-xs">
                  {c.result === "pass" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : c.result === "warn" ? <AlertTriangle className="size-4 shrink-0 text-warning" /> : <XCircle className="size-4 shrink-0 text-danger" />}
                  <span><span className="font-medium text-fg">{c.name}</span><span className="block text-fg-muted">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {job.scriptDe && job.status !== "script_review" && (
          <Disclosure title="German script"><p className="text-xs leading-relaxed whitespace-pre-wrap text-fg-secondary">{job.scriptDe}</p></Disclosure>
        )}
        {!!job.visualPlan?.length && (
          <Disclosure title="Visual plan"><ol className="list-decimal space-y-1 pl-4 text-xs text-fg-secondary">{job.visualPlan.map((v, i) => <li key={i}>{v}</li>)}</ol></Disclosure>
        )}
        <Disclosure title={`Activity · ${job.events.length}`}>
          <Activity events={job.events} />
        </Disclosure>
      </div>
      {rejectDialog}
    </article>
  );
}

/** Newest first; long histories fold after six entries. Hover a time for the exact timestamp. */
function Activity({ events }: { events: AgentJob["events"] }) {
  const [all, setAll] = useState(false);
  const rows = [...events].reverse();
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <>
      <ol className="space-y-1.5 border-l border-line pl-3">
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`} className="text-xs">
            <span className="text-fg-secondary [overflow-wrap:anywhere]">{e.text}</span>
            <time className="ml-1.5 text-fg-muted" dateTime={e.at} title={dateTime(e.at)}>{relativeTime(e.at)}</time>
          </li>
        ))}
      </ol>
      {rows.length > 6 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-medium text-accent hover:underline">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

/** Controlled disclosure: its open state is React state, so queue refreshes never collapse it. */
function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-fg-secondary hover:bg-subtle hover:text-fg">
        {title}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="px-3 pb-3 animate-fade-in">{children}</div>}
    </div>
  );
}
