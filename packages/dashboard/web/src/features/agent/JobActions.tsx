import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { setPrefs } from "@/lib/prefs";
import type { AgentJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, useConfirm } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/primitives";

export const MAX_ATTEMPTS = 3;

/** What a job can do right now; the queue card and the inline result card share these rules. */
export function jobFlags(job: AgentJob) {
  // A video exists once quality checks start; question-only jobs finish without one.
  const hasVideo = !!job.quality || job.stage === "quality";
  const replyOnly = job.status === "done" && !hasVideo;
  const stopped = ["error", "needs_review", "canceled"].includes(job.status);
  return {
    hasVideo,
    replyOnly,
    /** A project folder exists once narration starts, so a stopped render can still open in the Studio. */
    hasProject: hasVideo || (!!job.hasProject && !replyOnly),
    active: job.status === "queued" || job.status === "running" || job.status === "script_review",
    canRetry: stopped && job.attempts < MAX_ATTEMPTS,
    canEditScript: stopped && job.attempts < MAX_ATTEMPTS && !!job.scriptDe,
    canApprove: job.status === "done" && !!job.quality && !job.approvedAt,
    outOfAttempts: stopped && job.attempts >= MAX_ATTEMPTS,
  };
}

type Action = "approve" | "retry" | "cancel" | "reject" | "reopen";

export function useJobActions(job: AgentJob) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [pending, setPending] = useState<Action | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: keys.agent }),
    client.invalidateQueries({ queryKey: keys.agentSession(job.sessionId) }),
  ]);
  const clearEdit = () => setPrefs((p) => { const next = { ...p.agentScriptEdits }; delete next[job.id]; return { agentScriptEdits: next }; });

  async function run(action: Action, body: Record<string, unknown> = {}, done?: () => void) {
    setPending(action);
    try {
      await api.jobAction(job.id, action, body);
      done?.();
      await refresh();
      return true;
    } catch (err) {
      toast.error("Couldn't update the job", { description: errorMessage(err) });
      return false;
    } finally {
      setPending(null);
    }
  }

  return {
    pending,
    flags: jobFlags(job),
    approve: () => run("approve", {}, () => toast.success("Video approved")),
    retry: () => run("retry", {}, () => { clearEdit(); toast.success("Retry queued", { description: "Saved narration is reused when valid; an interrupted voice request may use credits again." }); }),
    reopen: () => run("reopen", {}, () => toast.success("Script reopened", { description: "Edit it in the review panel and approve it to produce again." })),
    cancel: async () => {
      const ok = await confirm({ title: "Cancel this job?", description: "Work in progress stops. Credits already spent are not refunded.", confirmLabel: "Cancel job", cancelLabel: "Keep running", tone: "danger" });
      if (ok) await run("cancel", {}, () => toast.success("Job canceled"));
    },
    /** Opens the note dialog; the note is recorded on the job and dropped into the chat's composer as the next brief. */
    requestChanges: () => setRejecting(true),
    rejectDialog: (
      <RequestChangesDialog
        open={rejecting}
        onOpenChange={setRejecting}
        loading={pending === "reject"}
        onSubmit={async (note) => {
          const ok = await run("reject", { note }, () => {
            setPrefs((p) => ({ agentDrafts: { ...p.agentDrafts, [job.sessionId]: note } }));
            toast.success("Changes requested", { description: "Your note is in the composer — send it to start the revision." });
          });
          if (ok) setRejecting(false);
        }}
      />
    ),
  };
}

function RequestChangesDialog({ open, onOpenChange, onSubmit, loading }:
  { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (note: string) => void; loading: boolean }) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) setNote(""); onOpenChange(o); }}
      title="Request changes"
      description="Say what should be different. The note is kept with this video and becomes the brief for the next revision."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={loading} disabled={!note.trim()} onClick={() => onSubmit(note.trim())}>Send back for changes</Button>
        </>
      }
    >
      <label htmlFor="reject-note" className="sr-only">What should change</label>
      <Textarea id="reject-note" autoFocus rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Hook is too slow — open with the question. Cut the second B-roll clip." />
    </Dialog>
  );
}
