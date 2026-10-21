import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, FileCheck2, RotateCcw, Lightbulb } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { spokenSeconds, wordCount } from "@/lib/format";
import { keys } from "@/lib/queries";
import type { AgentJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";

/** The human gate between "script written" and "spend credits on narration and render". */
export function ScriptReviewPanel({ job, edits, setEdits }: {
  job: AgentJob; edits: Record<string, string>; setEdits: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const text = edits[job.id] ?? job.scriptDe ?? "";
  const changed = text !== (job.scriptDe ?? "");
  const seconds = spokenSeconds(text);
  const off = Math.abs(seconds - job.targetSeconds) > Math.max(3, job.targetSeconds * 0.2);

  async function approve() {
    setBusy("approve");
    try {
      await api.jobAction(job.id, "approve", { scriptDe: text });
      setEdits((prev) => { const next = { ...prev }; delete next[job.id]; return next; });
      toast.success("Script approved", { description: "Narration, B-roll and render are queued." });
      await client.invalidateQueries({ queryKey: keys.agent });
    } catch (err) {
      toast.error("Couldn't approve the script", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!(await confirm({ title: "Discard this script?", description: "The job is cancelled. You can send a new brief at any time.", confirmLabel: "Discard", tone: "danger" }))) return;
    setBusy("cancel");
    try {
      await api.jobAction(job.id, "cancel");
      await client.invalidateQueries({ queryKey: keys.agent });
    } catch (err) {
      toast.error("Couldn't cancel the job", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shrink-0 border-t border-warning/30 bg-warning-subtle/60 px-4 py-4">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-line bg-surface p-4 shadow-md animate-fade-in">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FileCheck2 className="size-5 text-warning" aria-hidden />
          <h2 className="text-base font-semibold text-fg">Review the script</h2>
          <span className="text-sm text-fg-muted">— {job.title || "German script"}</span>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={off ? "warning" : "success"}><Clock className="size-3" /> ≈ {Math.round(seconds)} s / {job.targetSeconds} s target</Badge>
            <Badge>{wordCount(text)} words</Badge>
          </div>
        </div>
        {(job.rationale || job.usedPatternIds?.length) && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-accent/20 bg-accent-subtle/50 px-3 py-2 text-xs text-fg-secondary" data-testid="script-rationale">
            <Lightbulb className="size-3.5 shrink-0 text-accent" aria-hidden />
            {job.rationale && <span>{job.rationale}</span>}
            {job.usedPatternIds?.map((id) => <Badge key={id} tone="accent" className="font-mono">{id}</Badge>)}
          </div>
        )}
        <label htmlFor={`review-${job.id}`} className="sr-only">German script</label>
        <textarea
          id={`review-${job.id}`}
          value={text}
          lang="de"
          spellCheck={false}
          rows={6}
          onChange={(e) => setEdits((prev) => ({ ...prev, [job.id]: e.target.value }))}
          className="block max-h-72 w-full resize-y rounded-lg border border-line bg-bg px-3.5 py-3 text-base leading-7 text-fg outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {changed && (
            <Button size="sm" variant="ghost" onClick={() => setEdits((prev) => { const next = { ...prev }; delete next[job.id]; return next; })}>
              <RotateCcw /> Revert edits
            </Button>
          )}
          <p className="text-xs text-fg-muted">{job.productionMode === "heygen" ? `Approving uses ElevenLabs and HeyGen credits for ${job.avatarName || "your presenter"}, B-roll and captions.` : "Approving generates ElevenLabs narration (API credits) and renders the video."}</p>
          <div className="ml-auto flex gap-2">
            <Button variant="danger-ghost" size="sm" loading={busy === "cancel"} onClick={cancel}>Discard</Button>
            <Button variant="primary" loading={busy === "approve"} disabled={!text.trim()} onClick={approve}>Approve & produce</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
