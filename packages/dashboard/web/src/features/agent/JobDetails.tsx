import { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { dateTime, relativeTime } from "@/lib/format";
import type { AgentJob } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";

export type JobDetail = "quality" | "script" | "plan" | "activity";

const TITLES: Record<JobDetail, string> = { quality: "Quality report", script: "German script", plan: "Visual plan", activity: "Activity" };

/** One line for the technical checks: "All 8 checks passed", or how many did. */
export function qualitySummary(job: AgentJob) {
  const checks = job.quality?.checks ?? [];
  const passed = checks.filter((c) => c.result === "pass").length;
  const total = checks.length;
  const label = !total ? "" : passed === total ? (total === 1 ? "Technical check passed" : `All ${total} checks passed`) : `${passed} of ${total} checks passed`;
  return { passed, total, ok: !!job.quality?.passed, label };
}

/**
 * The details behind a result card, one at a time: quality report, the German script, the visual plan
 * and the activity log. They open from the card's "more" menu instead of sitting open on every card.
 */
export function JobDetailsDialog({ job, section, onClose }: { job: AgentJob; section: JobDetail | null; onClose: () => void }) {
  return (
    <Dialog open={!!section} onOpenChange={(o) => { if (!o) onClose(); }} title={section ? TITLES[section] : ""} description={job.title || undefined} size="lg">
      {section === "quality" && job.quality && (
        <ul className="space-y-2.5">
          {job.quality.checks.map((c) => (
            <li key={c.name} className="flex gap-2 text-sm">
              {c.result === "pass" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : c.result === "warn" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
              <span><span className="font-medium text-fg">{c.name}</span><span className="block text-xs text-fg-muted">{c.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      {section === "script" && <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-secondary [overflow-wrap:anywhere]">{job.scriptDe}</p>}
      {section === "plan" && !!job.visualPlan?.length && (
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-fg-secondary">{job.visualPlan.map((v, i) => <li key={i}>{v}</li>)}</ol>
      )}
      {section === "activity" && <Activity events={job.events} />}
    </Dialog>
  );
}

/** Newest first; long histories fold after six entries. Hover a time for the exact timestamp. */
export function Activity({ events }: { events: AgentJob["events"] }) {
  const [all, setAll] = useState(false);
  const rows = [...events].reverse();
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <>
      <ol className="space-y-1.5 border-l border-line pl-3">
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`} className="text-sm">
            <span className="text-fg-secondary [overflow-wrap:anywhere]">{e.text}</span>
            <time className="ml-1.5 text-xs text-fg-muted" dateTime={e.at} title={dateTime(e.at)}>{relativeTime(e.at)}</time>
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
