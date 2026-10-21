import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PerformanceStore } from "./store.js";
import { matchProject, syncFromInbox } from "./sync.js";

test("Ad names link to the longest matching project id and carry the variant key", () => {
  const ids = ["test_2026_10_11", "test_2026", "agent_abc"];
  assert.deepEqual(matchProject("DE | test_2026_10_11_h2_c1_9x16 | broad", ids), { projectId: "test_2026_10_11", variantKey: "h2_c1_9x16" });
  assert.deepEqual(matchProject("agent_abc", ids), { projectId: "agent_abc", variantKey: undefined });
  assert.equal(matchProject("Something else", ids), undefined);
});

const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
function metaCsv(ads: Array<{ id: string; name: string; hook: number; ctr: number; conv: number }>) {
  const lines = ["Day,Ad name,Ad ID,Campaign name,Impressions,Amount spent (EUR),Link clicks,3-second video plays,ThruPlays,Purchases,Purchases conversion value"];
  for (const d of days(30)) for (const a of ads) {
    const imp = 3000;
    lines.push([d, a.name, a.id, "DE", imp, 45, Math.round(imp * a.ctr), Math.round(imp * a.hook), Math.round(imp * a.hook * 0.3), a.conv, a.conv * 80].join(","));
  }
  return lines.join("\n");
}

test("Inbox sync imports CSVs once, links projects, scores ads, and skips unchanged files on the next run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));
  const inbox = path.join(dir, "inbox"); fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(inbox, "meta-october.csv"), metaCsv([
    { id: "1", name: "proj_a_h1_c1_9x16", hook: 0.35, ctr: 0.02, conv: 3 },
    { id: "2", name: "proj_a_h2_c1_9x16", hook: 0.2, ctr: 0.012, conv: 1 },
    { id: "3", name: "old creative", hook: 0.1, ctr: 0.005, conv: 0 },
    { id: "4", name: "mid creative", hook: 0.22, ctr: 0.011, conv: 1 },
  ]));
  fs.writeFileSync(path.join(inbox, "notes.txt"), "ignored");
  const store = new PerformanceStore(":memory:");
  const first = syncFromInbox(store, { inboxDir: inbox, projectIds: ["proj_a"], until: "2026-10-30" });
  assert.equal(first.files.length, 1); assert.equal(first.files[0].status, "imported");
  assert.equal(first.adsScored, 4); assert.equal(first.linked, 2); assert.equal(first.winners, 1);
  const scores = store.scores();
  assert.equal(scores[0].adId, "meta:1"); assert.equal(scores[0].isWinner, true); assert.equal(scores[0].confidence, "high");
  assert.equal(store.ad("meta:1")?.variantKey, "h1_c1_9x16");
  assert.ok(store.scores().find((s) => s.adId === "meta:3")?.isLoser);

  const second = syncFromInbox(store, { inboxDir: inbox, projectIds: ["proj_a"], until: "2026-10-30" });
  assert.equal(second.files[0].status, "unchanged"); assert.equal(second.adsScored, 4);

  store.linkAdToProject("meta:3", "proj_b", null);
  assert.equal(store.ad("meta:3")?.projectId, "proj_b");
  assert.equal(store.dailySeries("meta:1", 7).length, 7);
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("A broken CSV is reported per file without stopping the others", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));
  fs.writeFileSync(path.join(dir, "mystery.csv"), "a,b\n1,2");
  fs.writeFileSync(path.join(dir, "meta-ok.csv"), metaCsv([{ id: "9", name: "x", hook: 0.3, ctr: 0.01, conv: 1 }]));
  const store = new PerformanceStore(":memory:");
  const r = syncFromInbox(store, { inboxDir: dir, projectIds: [] });
  assert.equal(r.files.find((f) => f.file === "mystery.csv")?.status, "error");
  assert.equal(r.files.find((f) => f.file === "meta-ok.csv")?.status, "imported");
  assert.equal(r.adsScored, 1);
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});
