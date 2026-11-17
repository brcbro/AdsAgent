import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Clapperboard, FileEdit, FileText, History, ListOrdered, MessageSquareWarning, MoreHorizontal, RotateCw, ShieldCheck, X } from "lucide-react";
import { videoUrl } from "@/lib/api";
import { cn, JOB_STATUS, relativeTime, truncateWords } from "@/lib/format";
import type { AgentJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Menu, type MenuEntry } from "@/components/ui/menu";
import { Badge } from "@/components/ui/primitives";
import { useJobActions } from "./JobActions";
import { JobDetailsDialog, qualitySummary, type JobDetail } from "./JobDetails";
import { StageStepper } from "./StageStepper";

/**
 * A finished, failed or stopped job shown inside the conversation, right after the agent's message
 * about it. This is the one place the video lives: one player, one main button (Approve), and the
 * rest (request changes, script, quality report, activity) behind the "more" menu.
 */
export function JobResultCard({ job }: { job: AgentJob }) {
  const navigate = useNavigate();
  const { flags, pending, approve, retry, reopen, cancel, requestChanges, rejectDialog } = useJobActions(job);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const status = JOB_STATUS[job.status];
  const quality = job.quality ? qualitySummary(job) : null;
  const tone = job.approvedAt ? "border-success/40" : job.status === "error" ? "border-danger/40" : job.status === "needs_review" ? "border-warning/40" : "border-line";

  // These items open dialogs, so focus must stay with the dialog instead of returning to the menu button.
  const more: MenuEntry[] = [
    ...(flags.canApprove ? [{ label: "Request changes", icon: <MessageSquareWarning />, onSelect: requestChanges, keepFocus: true }] : []),
    ...(job.scriptDe ? [{ label: "German script", icon: <FileText />, onSelect: () => setDetail("script"), keepFocus: true, separatorBefore: flags.canApprove }] : []),
    ...(job.quality ? [{ label: "Quality report", icon: <ShieldCheck />, onSelect: () => setDetail("quality"), keepFocus: true }] : []),
    ...(job.visualPlan?.length ? [{ label: "Visual plan", icon: <ListOrdered />, onSelect: () => setDetail("plan"), keepFocus: true }] : []),
    { label: "Activity", icon: <History />, onSelect: () => setDetail("activity"), keepFocus: true },
  ];

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
          {job.avatarName || "Presenter"} · {job.targetSeconds} s target
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

        {flags.hasVideo && job.projectId && job.status === "done" && (
          <video src={videoUrl(job.projectId, job.updatedAt)} controls preload="none" playsInline
            className="mt-3 max-h-80 w-full rounded-md bg-stage" aria-label={`${job.title ?? "Agent"} video`} />
        )}
        {quality && (
          <button type="button" onClick={() => setDetail("quality")}
            className={cn("mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:brightness-95",
              quality.ok ? "bg-success-subtle text-success" : "bg-warning-subtle text-warning")}>
            {quality.ok ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
            <span className="font-medium">{quality.label}</span>
            <span className="ml-auto text-fg-muted">{job.quality!.durationSeconds.toFixed(1)} s</span>
            <ChevronRight className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="sr-only">Open the quality report</span>
          </button>
        )}
        {job.rejectionNote && (
          <p className="mt-3 rounded-md bg-warning-subtle/60 px-2.5 py-2 text-xs text-fg-secondary"><span className="font-medium text-warning">Requested:</span> {job.rejectionNote}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {flags.canApprove && <Button size="sm" variant="primary" loading={pending === "approve"} onClick={approve}><Check /> Approve</Button>}
          {flags.canRetry && <Button size="sm" variant={flags.canApprove ? "secondary" : "primary"} loading={pending === "retry"} onClick={retry}><RotateCw /> Retry</Button>}
          {flags.canEditScript && <Button size="sm" variant="secondary" loading={pending === "reopen"} onClick={reopen}><FileEdit /> Edit script</Button>}
          {flags.hasProject && <Button size="sm" variant="secondary" onClick={() => navigate(`/studio/${job.projectId}`)}><Clapperboard /> Open in Studio</Button>}
          <div className="ml-auto flex items-center gap-1.5">
            {flags.active && <Button size="sm" variant="danger-ghost" loading={pending === "cancel"} onClick={cancel}><X /> Cancel</Button>}
            <Menu items={more} className="w-52"
              trigger={<Button size="icon-sm" variant="secondary" aria-label="More actions" title="More actions"><MoreHorizontal /></Button>} />
          </div>
        </div>
        {rejectDialog}
        <JobDetailsDialog job={job} section={detail} onClose={() => setDetail(null)} />
      </article>
    </div>
  );
}
