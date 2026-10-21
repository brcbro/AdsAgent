import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "@ai-ads/core";
import type { QualityReport } from "./video-quality.js";

export type JobStatus = "queued" | "running" | "script_review" | "needs_review" | "done" | "error" | "canceled";
export interface AgentSession {
  id: string; title: string; createdAt: string; messages: Array<{ role: "user" | "assistant"; text: string; at: string }>;
  /** Set when a person renames the chat, so the first brief no longer overwrites the title. */
  titleLocked?: boolean;
  /** Archived chats are hidden from the list; their jobs stay in the queue history. */
  archivedAt?: string;
}
export interface AgentJob {
  id: string; sessionId: string; projectId: string; brief: string; targetSeconds: number; autoProduce: boolean;
  status: JobStatus; stage: "script" | "voice" | "avatar" | "render" | "quality" | "complete";
  productionMode?: "local" | "heygen"; avatarId?: string; avatarName?: string;
  createdAt: string; updatedAt: string; attempts: number; scriptDe?: string; title?: string; reply?: string;
  visualPlan?: string[]; quality?: QualityReport; error?: string; allowVoiceRetry?: boolean;
  /** Why the agent chose this hook / angle, and which winning patterns from the performance loop it applied. */
  rationale?: string; usedPatternIds?: string[];
  /** Human creative approval of a finished video (status "done"). Set only by approveJob, never automatically. */
  approvedAt?: string; approvedBy?: string;
  events: Array<{ at: string; text: string }>;
}
export const AGENT_DB_PATH = path.join(REPO_ROOT, "data", "agent-queue", "agent.sqlite");

export class AgentStore {
  readonly db: DatabaseSync;
  constructor(file = AGENT_DB_PATH) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, owner TEXT, lease INTEGER DEFAULT 0, created TEXT NOT NULL, doc TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS queue_status ON jobs(status, created);`);
    // Safe migration for databases created before approval existed. Another process (the worker) may add the column concurrently.
    const jobColumns = new Set(this.db.prepare("PRAGMA table_info(jobs)").all().map(r => String(r.name)));
    for (const column of ["approved_at", "approved_by"]) {
      if (jobColumns.has(column)) continue;
      try { this.db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`); } catch { /* added concurrently by another process */ }
    }
  }
  private toJob(row: Record<string, unknown>): AgentJob {
    const job: AgentJob = JSON.parse(String(row.doc));
    if (row.approved_at) { job.approvedAt = String(row.approved_at); if (row.approved_by) job.approvedBy = String(row.approved_by); }
    return job;
  }
  close() { this.db.close(); }
  sessions(): AgentSession[] { return this.db.prepare("SELECT doc FROM sessions WHERE json_extract(doc,'$.archivedAt') IS NULL ORDER BY rowid DESC LIMIT 100").all().map(r => JSON.parse(String(r.doc))); }
  session(id: string): AgentSession | undefined { const row = this.db.prepare("SELECT doc FROM sessions WHERE id=?").get(id); return row ? JSON.parse(String(row.doc)) : undefined; }
  saveSession(s: AgentSession) { this.db.prepare("INSERT INTO sessions(id,doc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc").run(s.id, JSON.stringify(s)); }
  newSession(): AgentSession { const s = { id: `chat_${randomUUID().replace(/-/g, "")}`, title: "New agent chat", createdAt: new Date().toISOString(), messages: [] }; this.saveSession(s); return s; }
  message(id: string, role: "user" | "assistant", text: string) {
    const s = this.session(id); if (!s) throw new Error("Chat not found");
    s.messages.push({ role, text, at: new Date().toISOString() });
    if (role === "user" && s.messages.length === 1 && !s.titleLocked) s.title = text.slice(0, 70);
    this.saveSession(s);
  }
  renameSession(id: string, title: string): AgentSession {
    const clean = title.trim().replace(/\s+/g, " ");
    if (!clean || clean.length > 120) throw new Error("Enter a chat name of 1–120 characters");
    const s = this.session(id); if (!s || s.archivedAt) throw new Error("Chat not found");
    s.title = clean; s.titleLocked = true; this.saveSession(s); return s;
  }
  /** Hides a chat. Jobs and their approvals are kept as history; a chat with active work can't be archived. */
  archiveSession(id: string): AgentSession {
    const s = this.session(id); if (!s || s.archivedAt) throw new Error("Chat not found");
    if (this.db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running','script_review') AND json_extract(doc,'$.sessionId')=?").get(id)) {
      throw new Error("Finish or cancel this chat's active job before archiving it");
    }
    s.archivedAt = new Date().toISOString(); this.saveSession(s); return s;
  }
  jobs(): AgentJob[] { return this.db.prepare("SELECT doc, approved_at, approved_by FROM jobs ORDER BY created DESC LIMIT 100").all().map(r => this.toJob(r)); }
  job(id: string): AgentJob | undefined { const row = this.db.prepare("SELECT doc, approved_at, approved_by FROM jobs WHERE id=?").get(id); return row ? this.toJob(row) : undefined; }
  enqueue(sessionId: string, brief: string, targetSeconds: number, autoProduce: boolean,
    production: { productionMode?: "local" | "heygen"; avatarId?: string; avatarName?: string } = {}): AgentJob {
    if (production.productionMode && !["local", "heygen"].includes(production.productionMode)) throw new Error("Invalid production mode");
    if (production.productionMode === "heygen" && !production.avatarId?.trim()) throw new Error("Choose a HeyGen avatar first");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.session(sessionId)) throw new Error("Chat not found");
      if (this.db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') AND json_extract(doc,'$.sessionId')=?").get(sessionId)) throw new Error("This chat already has a queued or running job");
      const stamp = new Date().toISOString(); const uid = randomUUID().replace(/-/g, "");
      const job: AgentJob = { id: `job_${uid}`, projectId: `agent_${uid}`, sessionId, brief, targetSeconds, autoProduce,
        productionMode: production.productionMode ?? "local", ...(production.productionMode === "heygen" ? { avatarId: production.avatarId, avatarName: production.avatarName } : {}),
        status: "queued", stage: "script", createdAt: stamp, updatedAt: stamp, attempts: 0, events: [{ at: stamp, text: "Brief saved to the persistent queue" }] };
      this.db.prepare("INSERT INTO jobs(id,status,created,doc) VALUES(?,?,?,?)").run(job.id, job.status, stamp, JSON.stringify(job));
      this.message(sessionId, "user", brief); this.db.exec("COMMIT"); return job;
    } catch (err) { this.db.exec("ROLLBACK"); throw err; }
  }
  claim(owner: string, now = Date.now()): AgentJob | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Only one agent job runs at a time, even if an old worker survives a dashboard restart.
      if (this.db.prepare("SELECT 1 FROM jobs WHERE status='running' AND lease>?").get(now)) { this.db.exec("COMMIT"); return; }
      const row = this.db.prepare("SELECT doc FROM jobs WHERE status='queued' OR (status='running' AND lease<=?) ORDER BY created LIMIT 1").get(now);
      if (!row) { this.db.exec("COMMIT"); return; }
      const job: AgentJob = JSON.parse(String(row.doc));
      job.status = "running"; job.attempts++; job.updatedAt = new Date(now).toISOString();
      job.events.push({ at: job.updatedAt, text: job.attempts > 1 ? "Resuming saved checkpoints after interruption" : "Worker started" });
      this.db.prepare("UPDATE jobs SET status='running',owner=?,lease=?,doc=? WHERE id=?").run(owner, now + 30_000, JSON.stringify(job), job.id);
      this.db.exec("COMMIT"); return job;
    } catch (err) { this.db.exec("ROLLBACK"); throw err; }
  }
  heartbeat(id: string, owner: string): boolean { return !!this.db.prepare("UPDATE jobs SET lease=? WHERE id=? AND owner=? AND status='running'").run(Date.now() + 30_000, id, owner).changes; }
  checkpoint(job: AgentJob, owner: string, event?: string): boolean {
    job.updatedAt = new Date().toISOString(); if (event) job.events.push({ at: job.updatedAt, text: event });
    return !!this.db.prepare("UPDATE jobs SET status=?,doc=?,lease=? WHERE id=? AND owner=? AND status='running'").run(job.status, JSON.stringify(job), job.status === "running" ? Date.now() + 30_000 : 0, job.id, owner).changes;
  }
  retry(id: string): AgentJob {
    const job = this.job(id); if (!job || !["error", "needs_review", "canceled"].includes(job.status)) throw new Error("This job cannot be retried");
    if (this.db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') AND json_extract(doc,'$.sessionId')=?").get(job.sessionId)) throw new Error("Wait for the active job in this chat first");
    if (job.attempts >= 3) throw new Error("Three attempts reached. Start a new brief after reviewing the error.");
    job.status = "queued"; job.allowVoiceRetry = true; delete job.error;
    job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Retry requested; saved script and audio will be reused where valid" });
    this.db.prepare("UPDATE jobs SET status='queued',owner=NULL,lease=0,doc=? WHERE id=?").run(JSON.stringify(job), id); return job;
  }
  approve(id: string, scriptDe: string): AgentJob {
    const job = this.job(id); if (!job || job.status !== "script_review") throw new Error("No script awaiting review");
    if (this.db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') AND json_extract(doc,'$.sessionId')=?").get(job.sessionId)) throw new Error("Wait for the active job in this chat first");
    if (scriptDe.trim().length < 30 || scriptDe.length > 1500) throw new Error("Script must contain 30–1500 characters");
    job.scriptDe = scriptDe.trim(); job.status = "queued"; job.stage = "voice"; job.autoProduce = true;
    job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Edited script approved for ElevenLabs and B-roll production" });
    this.db.prepare("UPDATE jobs SET status='queued',owner=NULL,lease=0,doc=? WHERE id=?").run(JSON.stringify(job), id); return job;
  }
  cancel(id: string): AgentJob {
    const job = this.job(id); if (!job || !["queued", "running", "script_review"].includes(job.status)) throw new Error("This job is not active");
    job.status = "canceled"; job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Canceled by user" });
    this.db.prepare("UPDATE jobs SET status='canceled',lease=0,doc=? WHERE id=?").run(JSON.stringify(job), id); return job;
  }
  /** Records a human's creative approval of a finished ("done") job. Returns false if the job is missing, not done, or already approved. */
  approveJob(id: string, owner?: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const job = this.job(id);
      // Only rendered videos carry a quality report; chat-only replies also end as "done".
      if (!job || job.status !== "done" || !job.quality || job.approvedAt) { this.db.exec("COMMIT"); return false; }
      const approvedAt = new Date().toISOString();
      job.events.push({ at: approvedAt, text: "Final video approved by a human reviewer" });
      const changes = this.db.prepare("UPDATE jobs SET approved_at=?, approved_by=?, doc=? WHERE id=? AND status='done' AND approved_at IS NULL")
        .run(approvedAt, owner ?? null, JSON.stringify(job), id).changes;
      this.db.exec("COMMIT"); return !!changes;
    } catch (err) { this.db.exec("ROLLBACK"); throw err; }
  }
}
