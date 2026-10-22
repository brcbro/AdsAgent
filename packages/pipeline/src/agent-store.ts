import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "@ai-ads/core";
import type { QualityReport } from "./video-quality.js";

export type JobStatus = "queued" | "running" | "script_review" | "needs_review" | "done" | "error" | "canceled";
export interface AgentMessage { role: "user" | "assistant"; text: string; at: string }
export interface AgentSession {
  id: string; title: string; createdAt: string; messages: AgentMessage[];
  /** Set when a person renames the chat, so neither the first brief nor the agent's title overwrites it. */
  titleLocked?: boolean;
  /** Archived chats are hidden from the list; their jobs stay in the queue history. */
  archivedAt?: string;
}
/** What the chat list needs: everything but the message history. */
export interface AgentSessionSummary {
  id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; lastMessage?: AgentMessage;
  titleLocked?: boolean; archivedAt?: string;
}
export interface AgentJob {
  id: string; sessionId: string; projectId: string; brief: string; targetSeconds: number; autoProduce: boolean;
  status: JobStatus; stage: "script" | "voice" | "avatar" | "render" | "quality" | "complete";
  productionMode?: "local" | "heygen"; avatarId?: string; avatarName?: string;
  createdAt: string; updatedAt: string; attempts: number; scriptDe?: string; title?: string; reply?: string;
  visualPlan?: string[]; quality?: QualityReport; error?: string; allowVoiceRetry?: boolean;
  /** A project folder exists under data/ads once narration starts, so the Studio can open it even if the render stopped. */
  hasProject?: boolean;
  /** Why the agent chose this hook / angle, and which winning patterns from the performance loop it applied. */
  rationale?: string; usedPatternIds?: string[];
  /** Human creative approval of a finished video (status "done"). Set only by approveJob, never automatically. */
  approvedAt?: string; approvedBy?: string;
  /** A reviewer asked for changes to a finished video; the note is the brief for the next revision. */
  rejectedAt?: string; rejectionNote?: string;
  events: Array<{ at: string; text: string }>;
}
export const AGENT_DB_PATH = path.join(REPO_ROOT, "data", "agent-queue", "agent.sqlite");
export const SCRIPT_MIN_CHARS = 30;
export const SCRIPT_MAX_CHARS = 1500;
export const MAX_ATTEMPTS = 3;
const ACTIVE = "('queued','running','script_review')";

/** Cut a title at a word boundary so chats never read "…with the selected He". */
export function titleFromText(text: string, max = 70): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max * 0.5 ? cut.slice(0, atWord) : cut.slice(0, max)).replace(/[\s.,;:!?—–-]+$/, "")}…`;
}

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
  private summary(s: AgentSession): AgentSessionSummary {
    const last = s.messages[s.messages.length - 1];
    return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: last?.at ?? s.createdAt, messageCount: s.messages.length,
      lastMessage: last, ...(s.titleLocked ? { titleLocked: true } : {}), ...(s.archivedAt ? { archivedAt: s.archivedAt } : {}) };
  }
  private hasActiveJob(sessionId: string, statuses = "('queued','running')"): boolean {
    return !!this.db.prepare(`SELECT 1 FROM jobs WHERE status IN ${statuses} AND json_extract(doc,'$.sessionId')=?`).get(sessionId);
  }
  close() { this.db.close(); }

  /* ---------- Sessions ---------- */
  sessions(): AgentSession[] { return this.db.prepare("SELECT doc FROM sessions WHERE json_extract(doc,'$.archivedAt') IS NULL ORDER BY rowid DESC").all().map(r => JSON.parse(String(r.doc))); }
  /** Chat list without message bodies; the dashboard polls this. */
  sessionSummaries(archived = false): AgentSessionSummary[] {
    return this.db.prepare(`SELECT doc FROM sessions WHERE json_extract(doc,'$.archivedAt') IS ${archived ? "NOT NULL" : "NULL"} ORDER BY rowid DESC`)
      .all().map(r => this.summary(JSON.parse(String(r.doc))));
  }
  /** Chats whose title or any message contains the text (case-insensitive). */
  searchSessions(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.db.prepare("SELECT id, doc FROM sessions WHERE json_extract(doc,'$.archivedAt') IS NULL ORDER BY rowid DESC").all()
      .filter(r => { const s: AgentSession = JSON.parse(String(r.doc)); return s.title.toLowerCase().includes(q) || s.messages.some(m => m.text.toLowerCase().includes(q)); })
      .map(r => String(r.id));
  }
  session(id: string): AgentSession | undefined { const row = this.db.prepare("SELECT doc FROM sessions WHERE id=?").get(id); return row ? JSON.parse(String(row.doc)) : undefined; }
  /** A chat that still accepts work: exists and is not archived. */
  liveSession(id: string): AgentSession {
    const s = this.session(id);
    if (!s) throw new Error("Chat not found");
    if (s.archivedAt) throw new Error("This chat is archived. Restore it before sending a brief.");
    return s;
  }
  saveSession(s: AgentSession) { this.db.prepare("INSERT INTO sessions(id,doc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc").run(s.id, JSON.stringify(s)); }
  /** Opens a chat. An existing empty chat is reused so "New chat" never piles up blank conversations. */
  newSession(): AgentSession {
    const empty = this.db.prepare("SELECT doc FROM sessions WHERE json_extract(doc,'$.archivedAt') IS NULL AND json_array_length(doc,'$.messages')=0 ORDER BY rowid DESC LIMIT 1").get();
    if (empty) {
      const s: AgentSession = JSON.parse(String(empty.doc));
      if (!this.hasActiveJob(s.id, ACTIVE)) return s;
    }
    const s = { id: `chat_${randomUUID().replace(/-/g, "")}`, title: "New chat", createdAt: new Date().toISOString(), messages: [] };
    this.saveSession(s); return s;
  }
  message(id: string, role: "user" | "assistant", text: string) {
    const s = this.session(id); if (!s) throw new Error("Chat not found");
    s.messages.push({ role, text, at: new Date().toISOString() });
    if (role === "user" && s.messages.length === 1 && !s.titleLocked) s.title = titleFromText(text);
    this.saveSession(s);
  }
  /** The agent's own title for the first brief replaces the truncated message text unless a person renamed the chat. */
  autoTitle(id: string, title: string) {
    const clean = title.trim().replace(/\s+/g, " ");
    const s = this.session(id); if (!s || s.titleLocked || !clean) return;
    if (s.messages.filter(m => m.role === "user").length > 1) return;
    s.title = clean.slice(0, 120); this.saveSession(s);
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
    if (this.hasActiveJob(id, ACTIVE)) throw new Error("Finish or cancel this chat's active job before archiving it");
    s.archivedAt = new Date().toISOString(); this.saveSession(s); return s;
  }
  unarchiveSession(id: string): AgentSession {
    const s = this.session(id); if (!s || !s.archivedAt) throw new Error("This chat is not archived");
    delete s.archivedAt; this.saveSession(s); return s;
  }

  /* ---------- Jobs ---------- */
  /** Newest first. Every active job is always included so the queue never hides running work behind a page limit. */
  jobs(opts: { limit?: number; offset?: number; sessionId?: string } = {}): AgentJob[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const where = opts.sessionId ? "WHERE json_extract(doc,'$.sessionId')=?" : "";
    const args = opts.sessionId ? [opts.sessionId] : [];
    const page = this.db.prepare(`SELECT doc, approved_at, approved_by FROM jobs ${where} ORDER BY created DESC LIMIT ? OFFSET ?`).all(...args, limit, opts.offset ?? 0).map(r => this.toJob(r));
    if (opts.offset) return page;
    const seen = new Set(page.map(j => j.id));
    const active = this.db.prepare(`SELECT doc, approved_at, approved_by FROM jobs WHERE status IN ${ACTIVE} ${where ? "AND json_extract(doc,'$.sessionId')=?" : ""} ORDER BY created DESC`).all(...args).map(r => this.toJob(r));
    return [...active.filter(j => !seen.has(j.id)), ...page];
  }
  jobCount(sessionId?: string): number {
    const row = sessionId
      ? this.db.prepare("SELECT count(*) n FROM jobs WHERE json_extract(doc,'$.sessionId')=?").get(sessionId)
      : this.db.prepare("SELECT count(*) n FROM jobs").get();
    return Number(row?.n ?? 0);
  }
  job(id: string): AgentJob | undefined { const row = this.db.prepare("SELECT doc, approved_at, approved_by FROM jobs WHERE id=?").get(id); return row ? this.toJob(row) : undefined; }
  private save(job: AgentJob, resetOwner = false) {
    this.db.prepare(`UPDATE jobs SET status=?,doc=?${resetOwner ? ",owner=NULL,lease=0" : ""} WHERE id=?`).run(job.status, JSON.stringify(job), job.id);
  }
  /**
   * Queues a brief. A script still awaiting review in the same chat is superseded (canceled) by the
   * new brief, so a chat never carries two pending reviews; a queued or running job still blocks.
   */
  enqueue(sessionId: string, brief: string, targetSeconds: number, autoProduce: boolean,
    production: { productionMode?: "local" | "heygen"; avatarId?: string; avatarName?: string } = {}): AgentJob {
    if (production.productionMode && !["local", "heygen"].includes(production.productionMode)) throw new Error("Invalid production mode");
    if (production.productionMode === "heygen" && !production.avatarId?.trim()) throw new Error("Choose a HeyGen avatar first");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.liveSession(sessionId);
      if (this.hasActiveJob(sessionId)) throw new Error("This chat already has a queued or running job");
      const stamp = new Date().toISOString(); const uid = randomUUID().replace(/-/g, "");
      for (const row of this.db.prepare("SELECT doc FROM jobs WHERE status='script_review' AND json_extract(doc,'$.sessionId')=?").all(sessionId)) {
        const pending: AgentJob = JSON.parse(String(row.doc));
        pending.status = "canceled"; pending.updatedAt = stamp; pending.events.push({ at: stamp, text: "Superseded by a new brief in this chat" });
        this.db.prepare("UPDATE jobs SET status='canceled',lease=0,doc=? WHERE id=?").run(JSON.stringify(pending), pending.id);
      }
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
  private retryable(job: AgentJob | undefined): AgentJob {
    if (!job || !["error", "needs_review", "canceled"].includes(job.status)) throw new Error("This job cannot be retried");
    if (this.hasActiveJob(job.sessionId)) throw new Error("Wait for the active job in this chat first");
    if (job.attempts >= MAX_ATTEMPTS) throw new Error("Three attempts reached. Start a new brief after reviewing the error.");
    return job;
  }
  retry(id: string): AgentJob {
    const job = this.retryable(this.job(id));
    job.status = "queued"; job.allowVoiceRetry = true; delete job.error;
    job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Retry requested; saved script and audio will be reused where valid" });
    this.save(job, true); return job;
  }
  /** Sends a stopped job's script back to the review gate so it can be edited before another attempt. */
  reopenScript(id: string): AgentJob {
    const job = this.retryable(this.job(id));
    if (!job.scriptDe) throw new Error("This job has no script to edit");
    if (this.db.prepare("SELECT 1 FROM jobs WHERE status='script_review' AND json_extract(doc,'$.sessionId')=?").get(job.sessionId)) throw new Error("Another script in this chat is already under review");
    job.status = "script_review"; job.stage = "voice"; job.autoProduce = false; job.allowVoiceRetry = true;
    job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Script reopened for editing" });
    this.save(job, true); return job;
  }
  approve(id: string, scriptDe: string): AgentJob {
    const job = this.job(id); if (!job || job.status !== "script_review") throw new Error("No script awaiting review");
    if (this.hasActiveJob(job.sessionId)) throw new Error("Wait for the active job in this chat first");
    if (scriptDe.trim().length < SCRIPT_MIN_CHARS || scriptDe.length > SCRIPT_MAX_CHARS) throw new Error(`Script must contain ${SCRIPT_MIN_CHARS}–${SCRIPT_MAX_CHARS} characters`);
    job.scriptDe = scriptDe.trim(); job.status = "queued"; job.stage = "voice"; job.autoProduce = true; delete job.error;
    job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: "Edited script approved for ElevenLabs and B-roll production" });
    this.save(job, true); return job;
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
      delete job.rejectedAt; delete job.rejectionNote;
      job.events.push({ at: approvedAt, text: `Final video approved by ${owner || "a human reviewer"}` });
      const changes = this.db.prepare("UPDATE jobs SET approved_at=?, approved_by=?, doc=? WHERE id=? AND status='done' AND approved_at IS NULL")
        .run(approvedAt, owner ?? null, JSON.stringify(job), id).changes;
      this.db.exec("COMMIT"); return !!changes;
    } catch (err) { this.db.exec("ROLLBACK"); throw err; }
  }
  /** A reviewer declines a finished video. The note becomes the brief for the next revision in the chat. */
  requestChanges(id: string, note: string): AgentJob {
    const job = this.job(id);
    if (!job || job.status !== "done" || !job.quality) throw new Error("Only a finished video can be sent back for changes");
    if (job.approvedAt) throw new Error("This video is already approved");
    const clean = note.trim();
    if (!clean || clean.length > 2000) throw new Error("Describe the changes in 1–2000 characters");
    job.rejectedAt = new Date().toISOString(); job.rejectionNote = clean; job.updatedAt = job.rejectedAt;
    job.events.push({ at: job.rejectedAt, text: `Changes requested: ${clean}` });
    this.save(job); return job;
  }
}
