import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentStore, titleFromText } from "./agent-store.js";

test("Production mode and selected presenter persist; legacy jobs stay local and invalid avatar jobs fail", () => {
  const store = new AgentStore(":memory:");
  try {
    const s = store.newSession();
    assert.throws(() => store.enqueue(s.id, "Test", 10, true, { productionMode: "heygen" }), /Choose a HeyGen avatar/);
    const j = store.enqueue(s.id, "German avatar video", 10, false, { productionMode: "heygen", avatarId: "presenter", avatarName: "Presenter" });
    assert.equal(store.claim("worker")?.productionMode, "heygen");
    assert.equal(store.job(j.id)?.avatarId, "presenter"); store.cancel(j.id);
    const local = store.enqueue(s.id, "Local preview", 10, true);
    assert.equal(local.productionMode, "local"); assert.equal(local.avatarId, undefined);
  } finally { store.close(); }
});

test("Queue and conversation persist, live leases prevent duplicate workers, expired jobs resume checkpoints", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-agent-test-"));
  const file = path.join(dir, "queue.sqlite");
  let first = new AgentStore(file); let second: AgentStore | undefined;
  try {
    const session = first.newSession(); const job = first.enqueue(session.id, "Create a German video", 20, true);
    assert.throws(() => first.enqueue(session.id, "Duplicate brief", 20, true), /already/);
    const claimed = first.claim("worker-a", Date.now())!;
    claimed.scriptDe = "Ein gespeichertes deutsches Skript."; claimed.stage = "voice";
    assert.equal(first.checkpoint(claimed, "worker-a", "Script saved"), true);
    second = new AgentStore(file);
    assert.equal(second.claim("worker-b"), undefined);
    first.close(); first = new AgentStore(file);
    assert.equal(first.session(session.id)?.messages[0].text, "Create a German video");
    const resumed = second.claim("worker-b", Date.now() + 31_000)!;
    assert.equal(resumed.id, job.id); assert.equal(resumed.scriptDe, claimed.scriptDe); assert.equal(resumed.attempts, 2);
    assert.equal(first.checkpoint(claimed, "worker-a"), false);
    assert.equal(first.cancel(job.id).status, "canceled");
    assert.equal(second.heartbeat(job.id, "worker-b"), false);
    assert.equal(second.checkpoint(resumed, "worker-b"), false);
  } finally {
    first.close(); second?.close();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Reviewed scripts queue once and failures require explicit bounded retry", () => {
  const store = new AgentStore(":memory:");
  try {
    const session = store.newSession(); const created = store.enqueue(session.id, "German script only", 20, false);
    const job = store.claim("worker")!; job.status = "script_review"; job.scriptDe = "Bitte lernen Sie diszipliniertes Trading mit klaren Regeln.";
    assert.equal(store.checkpoint(job, "worker"), true);
    store.approve(created.id, job.scriptDe);
    assert.throws(() => store.approve(created.id, job.scriptDe!), /No script/);
    const running = store.claim("worker")!; running.status = "error"; store.checkpoint(running, "worker");
    store.retry(running.id); const third = store.claim("worker")!;
    third.status = "error"; store.checkpoint(third, "worker");
    assert.throws(() => store.retry(third.id), /Three attempts/);
  } finally { store.close(); }
});

test("Chats can be renamed and archived; active work blocks archiving and job history is kept", () => {
  const store = new AgentStore(":memory:");
  try {
    const session = store.newSession();
    assert.equal(store.renameSession(session.id, "  Q4   trading ads ").title, "Q4 trading ads");
    assert.throws(() => store.renameSession(session.id, "   "), /1–120/);
    // A renamed chat keeps its name when the first brief arrives.
    const job = store.enqueue(session.id, "Create a German video about risk", 20, true);
    assert.equal(store.session(session.id)?.title, "Q4 trading ads");
    assert.throws(() => store.archiveSession(session.id), /active job/);
    store.cancel(job.id);
    store.archiveSession(session.id);
    assert.equal(store.sessions().some((s) => s.id === session.id), false);
    assert.equal(store.job(job.id)?.sessionId, session.id);
    assert.throws(() => store.archiveSession(session.id), /not found/);
  } finally {
    store.close();
  }
});

test("A new brief supersedes the script awaiting review; archived chats reject briefs", () => {
  const store = new AgentStore(":memory:");
  try {
    const session = store.newSession();
    const first = store.enqueue(session.id, "Erstes Skript", 20, false);
    const job = store.claim("worker")!; job.status = "script_review"; job.scriptDe = "Ein erstes deutsches Skript zum Thema Trading.";
    assert.equal(store.checkpoint(job, "worker"), true);
    const second = store.enqueue(session.id, "Bitte kürzer", 20, false);
    assert.equal(store.job(first.id)?.status, "canceled");
    assert.match(store.job(first.id)!.events.at(-1)!.text, /Superseded/);
    assert.equal(store.job(second.id)?.status, "queued");
    store.cancel(second.id);
    store.archiveSession(session.id);
    assert.throws(() => store.enqueue(session.id, "Noch eins", 20, true), /archived/);
    store.unarchiveSession(session.id);
    assert.equal(store.enqueue(session.id, "Noch eins", 20, true).status, "queued");
  } finally { store.close(); }
});

test("Titles cut at word boundaries, the agent's title wins until a person renames, and empty chats are reused", () => {
  assert.equal(titleFromText("Create a ten-second German educational test video with the selected HeyGen presenter"), "Create a ten-second German educational test video with the selected…");
  assert.equal(titleFromText("Short brief"), "Short brief");
  const store = new AgentStore(":memory:");
  try {
    const a = store.newSession();
    assert.equal(store.newSession().id, a.id, "an empty chat is handed back instead of a new one");
    assert.equal(a.title, "New chat");
    store.enqueue(a.id, "Create a ten-second German educational test video with the selected HeyGen presenter", 10, true);
    assert.equal(store.session(a.id)?.title, "Create a ten-second German educational test video with the selected…");
    store.autoTitle(a.id, "Beginner trading discipline");
    assert.equal(store.session(a.id)?.title, "Beginner trading discipline");
    store.renameSession(a.id, "Mine");
    store.autoTitle(a.id, "Ignored");
    assert.equal(store.session(a.id)?.title, "Mine");
    const b = store.newSession();
    assert.notEqual(b.id, a.id);
  } finally { store.close(); }
});

test("Stopped jobs reopen for script editing; finished videos can be sent back with a note; pagination keeps active jobs", () => {
  const store = new AgentStore(":memory:");
  try {
    const session = store.newSession();
    const created = store.enqueue(session.id, "Video", 20, true);
    const job = store.claim("worker")!; job.scriptDe = "Garantiert reich werden mit diesem einen Trick, ganz ohne Risiko."; job.status = "needs_review"; job.error = "blocked";
    store.checkpoint(job, "worker");
    const reopened = store.reopenScript(created.id);
    assert.equal(reopened.status, "script_review"); assert.equal(reopened.error, "blocked", "the reason stays visible in the review panel");
    assert.throws(() => store.reopenScript(created.id), /cannot be retried/);
    store.approve(created.id, "Lerne Trading mit klaren Regeln und einem Plan für jeden Tag.");
    const run = store.claim("worker")!;
    run.status = "done"; run.stage = "complete"; run.quality = { passed: true, checkedAt: new Date().toISOString(), durationSeconds: 20, checks: [] };
    store.checkpoint(run, "worker");
    assert.throws(() => store.requestChanges(created.id, "   "), /1–2000/);
    const back = store.requestChanges(created.id, "Hook schneller");
    assert.equal(back.rejectionNote, "Hook schneller"); assert.ok(back.rejectedAt);
    assert.equal(store.approveJob(created.id, "reviewer"), true);
    const approved = store.job(created.id)!;
    assert.equal(approved.approvedBy, "reviewer"); assert.equal(approved.rejectedAt, undefined);
    assert.throws(() => store.requestChanges(created.id, "again"), /already approved/);

    for (let i = 0; i < 3; i++) { const s = store.newSession(); store.enqueue(s.id, `Old ${i}`, 20, true); store.cancel(store.jobs({ limit: 1 })[0].id); }
    const active = store.newSession(); const queued = store.enqueue(active.id, "Active", 20, true);
    const page = store.jobs({ limit: 2, offset: 0 });
    assert.ok(page.some((j) => j.id === queued.id));
    assert.equal(store.jobs({ limit: 2, offset: 2 }).length, 2);
    assert.equal(store.jobCount(), 5);
    assert.equal(store.jobCount(active.id), 1);
    assert.equal(store.sessionSummaries().find((s) => s.id === active.id)?.messageCount, 1);
    assert.deepEqual(store.searchSessions("hook schneller"), []);
    assert.deepEqual(store.searchSessions("Active"), [active.id]);
  } finally { store.close(); }
});
