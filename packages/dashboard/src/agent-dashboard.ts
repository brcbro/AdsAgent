import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type express from "express";
import { REPO_ROOT } from "@ai-ads/core";
import { AgentStore } from "../../pipeline/src/agent-store.js";
import { cachedAvatars } from "../../pipeline/src/avatar-catalog.js";
import { loadMetadata, saveMetadata } from "../../pipeline/src/produce.js";

export function installAgentDashboard(app: express.Express, manualBusy: () => boolean) {
  const store = new AgentStore();
  let worker: ChildProcess | undefined;
  let closing = false;
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
    fs.closeSync(log);
    child.on("exit", () => { if (worker === child) worker = undefined; });
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
  const fail = (res: express.Response, err: unknown) => res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  app.get("/api/agent/state", (_req, res) => res.json({ sessions: store.sessions(), jobs: store.jobs(), workerRunning: !!worker,
    mode: "Claude → ElevenLabs German → local preview or HeyGen v3 → B-roll → technical quality checks" }));
  app.post("/api/agent/sessions", (_req, res) => res.json(store.newSession()));
  app.post("/api/agent/sessions/:id/rename", (req, res) => {
    try { res.json(store.renameSession(req.params.id, String(req.body?.title ?? ""))); } catch (err) { fail(res, err); }
  });
  app.post("/api/agent/sessions/:id/archive", (req, res) => {
    try { res.json(store.archiveSession(req.params.id)); } catch (err) { fail(res, err); }
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
  // Same path serves two human gates: a reviewed script (script_review) and a finished video (done).
  // Finished videos are never approved automatically; this only runs on an explicit click.
  app.post("/api/agent/jobs/:id/approve", (req, res) => {
    const current = store.job(req.params.id);
    if (current?.status === "done") {
      if (!store.approveJob(current.id)) return res.status(409).json({ error: "This video is already approved" });
      return res.json(store.job(current.id));
    }
    if (current?.status !== "script_review") return res.status(409).json({ error: "Nothing awaiting approval for this job" });
    try { const job = store.approve(req.params.id, String(req.body?.scriptDe ?? "")); startWorker(); res.json(job); }
    catch (err) { fail(res, err); }
  });
  app.post("/api/agent/jobs/:id/retry", (req, res) => {
    try { const job = store.retry(req.params.id); startWorker(); res.json(job); }
    catch (err) { fail(res, err); }
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
    active: () => store.jobs().find(job => job.status === "running"),
    cancelProject: (id: string) => { const job = store.jobs().find(job => job.projectId === id && job.status === "running"); if (job) cancel(job.id); },
    close: () => { if (closing) return; closing = true; clearInterval(timer); stopWorker(); store.close(); },
  };
}
