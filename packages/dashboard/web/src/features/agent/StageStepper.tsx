import { cn } from "@/lib/format";
import type { AgentJob } from "@/lib/types";

type Step = { id: AgentJob["stage"] | "review"; label: string };
const STEPS: Step[] = [
  { id: "script", label: "Script" },
  { id: "review", label: "Review" },
  { id: "voice", label: "Voice" },
  { id: "avatar", label: "Avatar" },
  { id: "render", label: "Render" },
  { id: "quality", label: "QA" },
  { id: "complete", label: "Done" },
];

/** Whether the human script gate is part of this job's path (not auto-produced, or sent back for editing). */
export function hasReviewStep(job: AgentJob): boolean {
  return job.status === "script_review" || !job.autoProduce || job.events.some((e) => /script approved|reopened for editing|awaiting review/i.test(e.text));
}

/**
 * Stage progress for one job. Stays visible for failed and cancelled jobs with the step it stopped at
 * marked, so the card still says where things went wrong.
 */
export function StageStepper({ job, className }: { job: AgentJob; className?: string }) {
  const steps = STEPS.filter((s) => (s.id !== "avatar" || job.productionMode === "heygen") && (s.id !== "review" || hasReviewStep(job)));
  const currentId: Step["id"] = job.status === "script_review" ? "review" : job.stage;
  const index = steps.findIndex((s) => s.id === currentId);
  const finished = job.status === "done";
  const stopped = job.status === "error" || job.status === "canceled" || job.status === "needs_review";
  const waiting = job.status === "script_review" || job.status === "queued";
  return (
    <ol className={cn("flex items-center gap-1", className)} aria-label="Job progress">
      {steps.map((s, i) => {
        const done = finished || i < index;
        const now = !finished && i === index;
        const bar = done ? "bg-accent"
          : now && stopped ? (job.status === "canceled" ? "bg-fg-muted" : "bg-danger")
          : now && waiting ? "bg-warning"
          : now ? "bg-accent/50 animate-pulse-soft"
          : "bg-muted-surface";
        return (
          <li key={s.id} className="flex flex-1 flex-col gap-1" aria-current={now ? "step" : undefined}>
            <span className={cn("h-1 rounded-full", bar)} />
            <span className={cn("text-[11px]", now && stopped ? (job.status === "canceled" ? "text-fg-secondary" : "font-medium text-danger") : done || now ? "text-fg-secondary" : "text-fg-muted")}>
              {now && stopped && job.status !== "canceled" ? `Stopped: ${s.label}` : s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
