import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentStore } from "./agent-store.js";

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
