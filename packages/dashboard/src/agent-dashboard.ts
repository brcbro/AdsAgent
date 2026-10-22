import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type express from "express";
import { REPO_ROOT } from "@ai-ads/core";
import { AgentStore, SCRIPT_MAX_CHARS, SCRIPT_MIN_CHARS } from "../../pipeline/src/agent-store.js";
import { CHARS_PER_SECOND, estimateScriptSeconds } from "../../pipeline/src/agent-script.js";
import { cachedAvatars } from "../../pipeline/src/avatar-catalog.js";
import { checkScriptCompliance } from "../../pipeline/src/compliance.js";
import { loadMetadata, saveMetadata } from "../../pipeline/src/produce.js";

const JOB_PAGE = 50;

function reviewerName(): string {
  try { return os.userInfo().username; } catch { return "dashboard"; }
}

export function installAgentDashboard(app: express.Express, manualBusy: () => boolean) {
  const store = new AgentStore();
  let worker: ChildProcess | undefined;
  let closing = false;
  const workerInfo = { restarts: -1, startedAt: undefined as string | undefined, lastExit: undefined as string | undefined, lastExitCode: null as number | null };
  const logPath = path.join(REPO_ROOT, "data", "agent-queue", "worker.log");
  const lockPath = path.join(REPO_ROOT, "data", "agent-queue", "manual-render.lock");
  const startWorker = () => {
    if (closing || worker) return;
    const log = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
      path.join(REPO_ROOT, "packages", "pipeline", "src", "agent-worker.ts")], {
      cwd: REPO_ROOT, windowsHide: true, stdio: ["ignore", log, log],
    });
    worker = child;
    workerInfo.restarts++; workerInfo.startedAt = new Date().toISOString();
    fs.closeSync(log);
    child.on("exit", (code) => {
      if (worker === child) worker = undefined;
      workerInfo.lastExit = new Date().toISOString(); workerInfo.lastExitCode = code;
    });
    child.on("error", err => { fs.appendFileSync(logPath, `Worker launch failed: ${err.message}\n`); if (worker === child) worker = undefined; });
  };
  function stopWorker() {
    const child = worker; worker = undefined;
    if (!child?.pid) return;
    if (process.platform === "win32") execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    else child.kill("SIGTERM");
  }
  const timer = setInterval(() => {
    if (manualBusy()) fs.writeFileSync(lockPath, String(Date.now()));
    else if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    startWorker();
  }, 2000);
  const fail = (res: express.Response, err: unknown, status = 400) => res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  /** Secrets never reach the browser: the worker already redacts env values, but the log may hold older lines. */
  const tailLog = (lines: number) => {
    if (!fs.existsSync(logPath)) return [];
    const text = fs.readFileSync(logPath, "utf8");
    const all = text.split(/\r?\n/).filter(l => l && !/ExperimentalWarning|trace-warnings/.test(l));
    let out = all.slice(-lines).join("\n");
    for (const [key, value] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET/.test(key) && value && value.length > 8) out = out.replaceAll(value, "[redacted]");
    return out ? out.split("\n") : [];
  };
  const scriptCheck = (text: string) => ({
    findings: checkScriptCompliance(text),
    chars: text.trim().length, minChars: SCRIPT_MIN_CHARS, maxChars: SCRIPT_MAX_CHARS,
    seconds: Math.round(estimateScriptSeconds(text) * 10) / 10, charsPerSecond: CHARS_PER_SECOND,
  });

  // The list view polls this; it carries chat summaries (no message bodies) and the recent jobs plus every active one.
  app.get("/api/agent/state", (_req, res) => res.json({
    sessions: store.sessionSummaries(), jobs: store.jobs({ limit: JOB_PAGE }), totalJobs: store.jobCount(), workerRunning: !!worker,
    mode: "Claude → ElevenLabs German → local preview or HeyGen v3 → B-roll → technical quality checks" }));
  app.get("/api/agent/worker", (req, res) => res.json({ running: !!worker, ...workerInfo, restarts: Math.max(0, workerInfo.restarts),
    log: tailLog(Math.min(Number(req.query.lines ?? 80) || 80, 400)) }));
  app.get("/api/agent/sessions", (req, res) => {
    if (req.query.archived === "1") return res.json(store.sessionSummaries(true));
    if (typeof req.query.q === "string") return res.json({ ids: store.searchSessions(req.query.q) });
    res.json(store.sessionSummaries());
  });
  app.post("/api/agent/sessions", (_req, res) => res.json(store.newSession()));
  app.get("/api/agent/sessions/:id", (req, res) => {
    const s = store.session(req.params.id);
    if (!s) return res.status(404).json({ error: "Chat not found" });
    res.json(s);
  });
  app.post("/api/agent/sessions/:id/rename", (req, res) => {
    try { res.json(store.renameSession(req.params.id, String(req.body?.title ?? ""))); } catch (err) { fail(res, err); }
  });
  app.post("/api/agent/sessions/:id/archive", (req, res) => {
    try { res.json(store.archiveSession(req.params.id)); } catch (err) { fail(res, err); }
  });
  app.post("/api/agent/sessions/:id/unarchive", (req, res) => {
    try { res.json(store.unarchiveSession(req.params.id)); } catch (err) { fail(res, err); }
  });
  app.post("/api/agent/sessions/:id/messages", (req, res) => {
    const message = req.body?.message;
    const seconds = Number(req.body?.targetSeconds ?? 20);
    if (typeof message !== "string" || !message.trim() || message.length > 4000) return res.status(400).json({ error: "Enter a brief of 1–4000 characters" });
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 45) return res.status(400).json({ error: "Duration must be 10–45 seconds" });
    const productionMode = req.body?.productionMode ?? "local";
    if (!["local", "heygen"].includes(productionMode)) return res.status(400).json({ error: "Choose Local preview or HeyGen avatar" });
    const avatarId = String(req.body?.avatarId ?? process.env.HEYGEN_AVATAR_ID ?? "");
    const avatar = productionMode === "heygen" ? cachedAvatars().find(a => a.avatar_id === avatarId) : undefined;
    if (productionMode === "heygen" && !avatar) return res.status(400).json({ error: "Choose an available presenter from the refreshed HeyGen catalog" });
    try { const job = store.enqueue(req.params.id, message.trim(), seconds, req.body?.autoProduce !== false,
      { productionMode, avatarId: avatar?.avatar_id, avatarName: avatar?.avatar_name }); startWorker(); res.json(job); }
    catch (err) { fail(res, err); }
  });
  app.get("/api/agent/jobs", (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(Math.max(Number(req.query.limit ?? JOB_PAGE) || JOB_PAGE, 1), 200);
    res.json({ jobs: store.jobs({ sessionId, offset, limit }), total: store.jobCount(sessionId), offset, limit });
  });
  // Deterministic claim check plus the duration estimate the planner uses, for the review panel.
  app.post("/api/agent/script-check", (req, res) => {
    const text = typeof req.body?.scriptDe === "string" ? req.body.scriptDe : "";
    if (text.length > 20_000) return res.status(400).json({ error: "Script is too long to check" });
    res.json(scriptCheck(text));
  });
  // Same path serves two human gates: a reviewed script (script_review) and a finished video (done).
  // Finished videos are never approved automatically; this only runs on an explicit click.
  app.post("/api/agent/jobs/:id/approve", (req, res) => {
    const current = store.job(req.params.id);
    if (current?.status === "done") {
      if (!current.quality) return res.status(409).json({ error: "This job answered in the chat; there is no video to approve" });
      if (current.approvedAt) return res.status(409).json({ error: "This video is already approved" });
      if (!store.approveJob(current.id, reviewerName())) return res.status(409).json({ error: "This video could not be approved" });
      return res.json(store.job(current.id));
    }
    if (current?.status !== "script_review") return res.status(409).json({ error: "Nothing awaiting approval for this job" });
    const scriptDe = String(req.body?.scriptDe ?? "");
    const check = scriptCheck(scriptDe);
    const blocked = check.findings.filter(f => f.severity === "block");
    if (blocked.length) return res.status(400).json({ error: `The script still contains blocked claims: ${blocked.map(f => `"${f.match}"`).join(", ")}`, check });
    try { const job = store.approve(req.params.id, scriptDe); startWorker(); res.json(job); }
    catch (err) { fail(res, err); }
  });
  app.post("/api/agent/jobs/:id/reject", (req, res) => {
    try { res.json(store.requestChanges(req.params.id, String(req.body?.note ?? ""))); } catch (err) { fail(res, err); }
  });
  app.post("/api/agent/jobs/:id/retry", (req, res) => {
    try { const job = store.retry(req.params.id); startWorker(); res.json(job); }
    catch (err) { fail(res, err); }
  });
  app.post("/api/agent/jobs/:id/reopen", (req, res) => {
    try { res.json(store.reopenScript(req.params.id)); } catch (err) { fail(res, err); }
  });
  const cancel = (id: string) => {
    const job = store.job(id); const wasRunning = job?.status === "running";
    const result = store.cancel(id);
    if (wasRunning) stopWorker();
    const meta = job && loadMetadata(job.projectId);
    if (meta && meta.status !== "done") { meta.status = "draft"; delete meta.error; meta.updatedAt = new Date().toISOString(); saveMetadata(meta); }
    return result;
  };
  app.post("/api/agent/jobs/:id/cancel", (req, res) => { try { res.json(cancel(req.params.id)); } catch (err) { fail(res, err); } });
  return {
    start: startWorker,
    active: () => store.jobs({ limit: 1 }).find(job => job.status === "running"),
    cancelProject: (id: string) => { const job = store.jobs({ limit: 1 }).find(job => job.projectId === id && job.status === "running"); if (job) cancel(job.id); },
    close: () => { if (closing) return; closing = true; clearInterval(timer); stopWorker(); store.close(); },
  };
}
