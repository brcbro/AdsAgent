import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clapperboard, MessageSquare, RotateCw, X, XCircle } from "lucide-react";
import { api, errorMessage, videoUrl } from "@/lib/api";
import { cn, JOB_STATUS, relativeTime } from "@/lib/format";
import { keys } from "@/lib/queries";
import type { AgentJob, AgentSession, JobStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Badge, Segmented, Select } from "@/components/ui/primitives";

type Scope = "chat" | "all";
const PAGE = 20;
const STAGES: Array<{ id: AgentJob["stage"]; label: string }> = [
  { id: "script", label: "Script" },
  { id: "voice", label: "Voice" },
  { id: "avatar", label: "Avatar" },
  { id: "render", label: "Render" },
  { id: "quality", label: "QA" },
  { id: "complete", label: "Done" },
];

export function JobQueue({ jobs, sessionId, liveSessions, edits, setEdits, workerRunning }: {
  jobs: AgentJob[]; sessionId?: string; liveSessions: AgentSession[]; edits: Record<string, string>;
  setEdits: (fn: (prev: Record<string, string>) => Record<string, string>) => void; workerRunning: boolean;
}) {
  const [scope, setScope] = useState<Scope>("chat");
  const [status, setStatus] = useState<"" | JobStatus>("");
  const [limit, setLimit] = useState(PAGE);
  const list = jobs
    .filter((j) => scope === "all" || j.sessionId === sessionId)
    .filter((j) => !status || j.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <aside className="flex h-full w-[360px] max-w-full shrink-0 flex-col border-l border-line bg-surface" aria-label="Job queue">
      <div className="space-y-3 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Job queue</h2>
          <span className="flex items-center gap-1.5 text-xs text-fg-muted" title="The worker runs jobs in the background; the queue survives restarts.">
            <span className={cn("size-2 rounded-full", workerRunning ? "bg-success" : "bg-warning animate-pulse-soft")} aria-hidden />
            {workerRunning ? "Worker online" : "Worker restarting"}
          </span>
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
        {!list.length && (
          <p className="px-2 py-10 text-center text-sm text-fg-muted">
            {jobs.length ? "No jobs match these filters." : "Jobs appear here when you send a brief. Progress is saved through restarts."}
          </p>
        )}
        {list.slice(0, limit).map((job) => (
          <JobCard key={job.id} job={job} current={job.sessionId === sessionId} chatArchived={!liveSessions.some((s) => s.id === job.sessionId)} edited={edits[job.id] !== undefined} clearEdit={() => setEdits((p) => { const n = { ...p }; delete n[job.id]; return n; })} />
        ))}
        {list.length > limit && (
          <Button variant="secondary" className="w-full" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more</Button>
        )}
      </div>
    </aside>
  );
}

function JobCard({ job, current, chatArchived, edited, clearEdit }:
  { job: AgentJob; current: boolean; chatArchived: boolean; edited: boolean; clearEdit: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const status = JOB_STATUS[job.status];
  const active = job.status === "queued" || job.status === "running" || job.status === "script_review";
  // A video exists once quality checks start; question-only jobs finish without one.
  const hasVideo = !!job.quality || job.stage === "quality";
  const replyOnly = job.status === "done" && !hasVideo;
  const canRetry = ["error", "needs_review", "canceled"].includes(job.status) && job.attempts < 3;
  const passed = job.quality?.checks.filter((c) => c.result === "pass").length ?? 0;

  async function act(action: "approve" | "retry" | "cancel") {
    if (action === "cancel" && !(await confirm({ title: "Cancel this job?", description: "Work in progress stops. Credits already spent are not refunded.", confirmLabel: "Cancel job", cancelLabel: "Keep running", tone: "danger" }))) return;
    setPending(action);
    try {
      await api.jobAction(job.id, action);
      if (action === "retry") clearEdit();
      toast.success(action === "approve" ? "Video approved" : action === "retry" ? "Retry queued" : "Job canceled",
        action === "retry" ? { description: "Saved narration is reused when valid; an interrupted voice request may use credits again." } : undefined);
      await client.invalidateQueries({ queryKey: keys.agent });
    } catch (err) {
      toast.error("Couldn't update the job", { description: errorMessage(err) });
    } finally {
      setPending(null);
    }
  }

  return (
    <article className={cn("rounded-lg border bg-surface shadow-xs transition-colors", current ? "border-line-strong" : "border-line")}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg [overflow-wrap:anywhere]">{job.title || job.brief.slice(0, 70)}</h3>
          <Badge tone={status.tone} dot pulse={job.status === "running"}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {job.productionMode === "heygen" ? `HeyGen · ${job.avatarName || "Presenter"} · ` : "Local · "}
          {relativeTime(job.createdAt)} · {job.targetSeconds}s target · attempt {job.attempts}/3
          {job.approvedAt && <> · <span className="font-medium text-success">Approved</span></>}
          {edited && job.status === "script_review" && <> · <span className="text-warning">edited</span></>}
        </p>

        {replyOnly
          ? <p className="mt-3 rounded-md bg-subtle px-2.5 py-2 text-xs text-fg-secondary">Answered in the chat — no video was needed.</p>
          : job.status !== "canceled" && job.status !== "error" && <StageStepper stage={job.stage} status={job.status} hasAvatar={job.productionMode === "heygen"} />}

        {job.error && (
          <div className="mt-3 flex gap-2 rounded-md bg-danger-subtle p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{job.error}</span>
          </div>
        )}

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
          {job.status === "done" && job.quality && !job.approvedAt && <Button size="sm" variant="primary" loading={pending === "approve"} onClick={() => act("approve")}><Check /> Approve</Button>}
          {hasVideo && <Button size="sm" variant="secondary" onClick={() => navigate(`/studio/${job.projectId}`)}><Clapperboard /> Open in Studio</Button>}
          {canRetry && <Button size="sm" variant="secondary" loading={pending === "retry"} onClick={() => act("retry")}><RotateCw /> Retry</Button>}
          {!current && !chatArchived && <Button size="sm" variant="ghost" onClick={() => navigate(`/agent/${job.sessionId}`)}><MessageSquare /> Open chat</Button>}
          {chatArchived && <Badge>Chat archived</Badge>}
          {active && <Button size="sm" variant="danger-ghost" className="ml-auto" loading={pending === "cancel"} onClick={() => act("cancel")}><X /> Cancel</Button>}
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
          <ol className="space-y-1.5 border-l border-line pl-3">
            {[...job.events].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} className="text-xs">
                <span className="text-fg-secondary">{e.text}</span>
                <time className="ml-1.5 text-fg-muted" dateTime={e.at}>{relativeTime(e.at)}</time>
              </li>
            ))}
          </ol>
        </Disclosure>
      </div>
    </article>
  );
}

function StageStepper({ stage, status, hasAvatar }: { stage: AgentJob["stage"]; status: JobStatus; hasAvatar: boolean }) {
  const stages = STAGES.filter(s => s.id !== "avatar" || hasAvatar);
  const index = stages.findIndex((s) => s.id === stage);
  const finished = status === "done";
  return (
    <ol className="mt-3 flex items-center gap-1" aria-label="Job progress">
      {stages.map((s, i) => {
        const done = finished || i < index;
        const now = !finished && i === index;
        return (
          <li key={s.id} className="flex flex-1 flex-col gap-1" aria-current={now ? "step" : undefined}>
            <span className={cn("h-1 rounded-full", done ? "bg-accent" : now ? (status === "running" ? "bg-accent/50 animate-pulse-soft" : "bg-warning") : "bg-muted-surface")} />
            <span className={cn("text-[11px]", done || now ? "text-fg-secondary" : "text-fg-muted")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
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
