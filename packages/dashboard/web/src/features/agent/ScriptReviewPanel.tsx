import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Clock, FileCheck2, Lightbulb, MessageSquareReply, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn, scriptSeconds, wordCount } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { setPrefs, usePref } from "@/lib/prefs";
import { keys } from "@/lib/queries";
import type { AgentJob } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/dialog";
import { Badge, Textarea } from "@/components/ui/primitives";

const MIN_CHARS = 30;
const MAX_CHARS = 1500;

/** The human gate between "script written" and "spend credits on narration and render". */
export function ScriptReviewPanel({ job }: { job: AgentJob }) {
  const client = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"approve" | "cancel" | "revise" | null>(null);
  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState("");
  const [edits] = usePref("agentScriptEdits");
  const text = edits[job.id] ?? job.scriptDe ?? "";
  const setText = (v: string) => setPrefs((p) => ({ agentScriptEdits: { ...p.agentScriptEdits, [job.id]: v } }));
  const clearEdit = () => setPrefs((p) => { const next = { ...p.agentScriptEdits }; delete next[job.id]; return { agentScriptEdits: next }; });
  const changed = text !== (job.scriptDe ?? "");

  const chars = text.trim().length;
  const tooShort = chars < MIN_CHARS;
  const tooLong = text.length > MAX_CHARS;
  const seconds = scriptSeconds(text);
  const off = Math.abs(seconds - job.targetSeconds) > Math.max(3, job.targetSeconds * 0.2);

  // The same claim check the worker runs, so blocked wording is fixed here instead of after approval.
  const debounced = useDebounced(text, 400);
  const check = useQuery({ queryKey: ["script-check", debounced], queryFn: () => api.scriptCheck(debounced), staleTime: 60_000, placeholderData: keepPreviousData, enabled: debounced.trim().length > 0 });
  const findings = check.data?.findings ?? [];
  const blocked = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");
  const stale = check.isPlaceholderData || check.isFetching || debounced !== text;
  const approveReason = tooShort ? `Script needs at least ${MIN_CHARS} characters` : tooLong ? `Script must stay under ${MAX_CHARS} characters` : blocked.length && !stale ? "Remove the blocked claims first" : null;

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: keys.agent }), client.invalidateQueries({ queryKey: keys.agentSession(job.sessionId) })]);

  async function approve() {
    setBusy("approve");
    try {
      await api.jobAction(job.id, "approve", { scriptDe: text });
      clearEdit();
      toast.success("Script approved", { description: "Narration, B-roll and render are queued." });
      await refresh();
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
      clearEdit();
      await refresh();
    } catch (err) {
      toast.error("Couldn't cancel the job", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  /** Sends the note plus the current (possibly edited) script as the next brief; the server supersedes this review. */
  async function revise() {
    const ask = note.trim();
    if (!ask) return;
    setBusy("revise");
    try {
      await api.sendBrief(job.sessionId, {
        message: `${ask}\n\nAktuelles Skript:\n${text.trim()}`, targetSeconds: job.targetSeconds, autoProduce: false,
        productionMode: job.productionMode ?? "local", ...(job.productionMode === "heygen" && job.avatarId ? { avatarId: job.avatarId } : {}),
      });
      clearEdit();
      setNote(""); setRevising(false);
      toast.success("Revision requested", { description: "The agent rewrites the script; it comes back here for review." });
      await refresh();
    } catch (err) {
      toast.error("Couldn't request a revision", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shrink-0 border-t border-warning/30 bg-warning-subtle/60 px-4 py-3 sm:py-4" data-testid="script-review">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-line bg-surface p-3 shadow-md animate-fade-in sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FileCheck2 className="size-5 text-warning" aria-hidden />
          <h2 className="text-base font-semibold text-fg">Review the script</h2>
          <span className="hidden text-sm text-fg-muted sm:inline">— {job.title || "German script"}</span>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone={off ? "warning" : "success"}><Clock className="size-3" /> ≈ {Math.round(seconds)} s / {job.targetSeconds} s target</Badge>
            <Badge className="hidden sm:inline-flex">{wordCount(text)} words</Badge>
          </div>
        </div>
        {job.error && (
          <div className="mb-3 flex gap-2 rounded-md bg-danger-subtle p-2.5 text-xs text-danger" data-testid="review-error">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="[overflow-wrap:anywhere]">{job.error}</span>
          </div>
        )}
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
          rows={5}
          onChange={(e) => setText(e.target.value)}
          className={cn("block max-h-[40vh] w-full resize-y rounded-lg border bg-bg px-3.5 py-3 text-base leading-7 text-fg outline-none focus:ring-3 focus:ring-accent/15",
            tooLong || (blocked.length && !stale) ? "border-danger focus:border-danger" : "border-line focus:border-accent")}
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={cn("tabular", tooShort || tooLong ? "font-medium text-danger" : "text-fg-muted")} data-testid="script-chars">
            {chars}/{MAX_CHARS} characters{tooShort ? ` · at least ${MIN_CHARS}` : ""}
          </span>
          {debounced.trim() && !check.isError && (
            <span className={cn("inline-flex items-center gap-1", blocked.length ? "text-danger" : warnings.length ? "text-warning" : "text-success")} data-testid="script-compliance">
              {blocked.length ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
              {blocked.length ? `${blocked.length} blocked claim${blocked.length > 1 ? "s" : ""}` : warnings.length ? `${warnings.length} wording warning${warnings.length > 1 ? "s" : ""}` : "Claim check passed"}
            </span>
          )}
          {check.isError && <span className="text-fg-muted">Claim check unavailable; the server checks again on approval.</span>}
        </div>
        {findings.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Claim findings">
            {findings.map((f) => (
              <li key={`${f.rule}-${f.match}`} className={cn("flex gap-2 rounded-md px-2.5 py-1.5 text-xs", f.severity === "block" ? "bg-danger-subtle text-danger" : "bg-warning-subtle text-warning")}>
                <span className="font-medium">“{f.match}”</span>
                <span className="text-fg-secondary">{f.message}</span>
              </li>
            ))}
          </ul>
        )}

        {revising && (
          <div className="mt-3 rounded-lg border border-line bg-bg p-3" data-testid="revise-box">
            <label htmlFor={`revise-${job.id}`} className="mb-1.5 block text-xs font-medium text-fg-secondary">What should the agent change?</label>
            <Textarea id={`revise-${job.id}`} autoFocus rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void revise(); } }}
              placeholder="e.g. Shorter hook, address beginners directly, end with the webinar CTA." />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setRevising(false); setNote(""); }}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy === "revise"} disabled={!note.trim()} onClick={revise}>Send revision</Button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {changed && (
            <Button size="sm" variant="ghost" onClick={clearEdit}><RotateCcw /> Revert edits</Button>
          )}
          {!revising && <Button size="sm" variant="ghost" onClick={() => setRevising(true)}><MessageSquareReply /> Ask the agent to revise</Button>}
          <p className="hidden text-xs text-fg-muted sm:block">{job.productionMode === "heygen" ? `Approving uses ElevenLabs and HeyGen credits for ${job.avatarName || "your presenter"}, B-roll and captions.` : "Approving generates ElevenLabs narration (API credits) and renders the video."}</p>
          <div className="ml-auto flex gap-2">
            <Button variant="danger-ghost" size="sm" loading={busy === "cancel"} onClick={cancel}>Discard</Button>
            <Button variant="primary" loading={busy === "approve"} disabled={!!approveReason} title={approveReason ?? undefined} onClick={approve}>Approve & produce</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
