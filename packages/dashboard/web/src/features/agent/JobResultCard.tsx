import { useNavigate } from "react-router";
import { AlertTriangle, Check, CheckCircle2, Clapperboard, FileEdit, MessageSquareWarning, RotateCw, X } from "lucide-react";
import { videoUrl } from "@/lib/api";
import { cn, JOB_STATUS, relativeTime, truncateWords } from "@/lib/format";
import type { AgentJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { useJobActions } from "./JobActions";
import { StageStepper } from "./StageStepper";

/**
 * A finished, failed or stopped job shown inside the conversation, right after the agent's message
 * about it. On narrow screens this is the only place the video and its Approve button are visible.
 */
export function JobResultCard({ job }: { job: AgentJob }) {
  const navigate = useNavigate();
  const { flags, pending, approve, retry, reopen, cancel, requestChanges, rejectDialog } = useJobActions(job);
  const status = JOB_STATUS[job.status];
  const passed = job.quality?.checks.filter((c) => c.result === "pass").length ?? 0;
  const tone = job.approvedAt ? "border-success/40" : job.status === "error" ? "border-danger/40" : job.status === "needs_review" ? "border-warning/40" : "border-line";

  return (
    <div className="flex gap-3 animate-fade-in" data-testid="job-result">
      <div className="size-8 shrink-0" aria-hidden />
      <article className={cn("w-full max-w-[85%] rounded-2xl rounded-tl-md border bg-surface p-3 shadow-xs", tone)} aria-label={`Result: ${job.title || "video"}`}>
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-sm font-semibold text-fg [overflow-wrap:anywhere]">{job.title || truncateWords(job.brief, 70)}</h3>
          {job.approvedAt ? <Badge tone="success" dot>Approved</Badge>
            : job.rejectedAt ? <Badge tone="warning" dot>Changes requested</Badge>
            : <Badge tone={status.tone} dot>{status.label}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">
          {job.productionMode === "heygen" ? `HeyGen · ${job.avatarName || "Presenter"}` : "Local preview"} · {job.targetSeconds}s target
          {job.approvedAt && <> · approved {relativeTime(job.approvedAt)}{job.approvedBy ? ` by ${job.approvedBy}` : ""}</>}
        </p>

        {!flags.hasVideo && <StageStepper job={job} className="mt-3" />}

        {job.error && (
          <div className="mt-3 flex gap-2 rounded-md bg-danger-subtle p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{job.error}</span>
          </div>
        )}
        {flags.outOfAttempts && <p className="mt-2 text-xs text-fg-muted">Three attempts used. Start a new brief in the chat to try a different approach.</p>}

        {job.quality && (
          <div className={cn("mt-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs", job.quality.passed ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning")}>
            {job.quality.passed ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
            <span className="font-medium">{passed}/{job.quality.checks.length} technical checks passed</span>
            <span className="ml-auto text-fg-muted">{job.quality.durationSeconds.toFixed(1)} s</span>
          </div>
        )}
        {flags.hasVideo && job.projectId && job.status === "done" && (
          <video src={videoUrl(job.projectId, job.updatedAt)} controls preload="none" playsInline
            className="mt-3 max-h-80 w-full rounded-md bg-stage" aria-label={`${job.title ?? "Agent"} video`} />
        )}
        {job.rejectionNote && (
          <p className="mt-3 rounded-md bg-warning-subtle/60 px-2.5 py-2 text-xs text-fg-secondary"><span className="font-medium text-warning">Requested:</span> {job.rejectionNote}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {flags.canApprove && <Button size="sm" variant="primary" loading={pending === "approve"} onClick={approve}><Check /> Approve</Button>}
          {flags.canApprove && <Button size="sm" variant="secondary" onClick={requestChanges}><MessageSquareWarning /> Request changes</Button>}
          {flags.hasProject && <Button size="sm" variant="secondary" onClick={() => navigate(`/studio/${job.projectId}`)}><Clapperboard /> Open in Studio</Button>}
          {flags.canEditScript && <Button size="sm" variant="secondary" loading={pending === "reopen"} onClick={reopen}><FileEdit /> Edit script</Button>}
          {flags.canRetry && <Button size="sm" variant="ghost" loading={pending === "retry"} onClick={retry}><RotateCw /> Retry</Button>}
          {flags.active && <Button size="sm" variant="danger-ghost" className="ml-auto" loading={pending === "cancel"} onClick={cancel}><X /> Cancel</Button>}
        </div>
        {rejectDialog}
      </article>
    </div>
  );
}
