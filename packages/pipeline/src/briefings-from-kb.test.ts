import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listKbBriefings, recentBriefingAngles } from "./briefings-from-kb.js";

test("Recent angles come from the newest briefing files; KB briefings are listed newest first with their pattern ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-"));
  const briefing = (id: string, angle: string, extra: object = {}) => ({
    id, angle, persona: "p", painPoint: "x", promise: "y", tone: "t", visualDirection: ["a"], hookConcepts: ["h"], bodyConcept: "b", ctaConcepts: ["c"], source: "meta-analysis", ...extra,
  });
  fs.writeFileSync(path.join(dir, "manual.json"), JSON.stringify(briefing("m", "Manual angle", { source: "manual" })));
  fs.writeFileSync(path.join(dir, "kb_2026_10_21_01_fomo.json"), JSON.stringify(briefing("kb_1", "FOMO angle", { usedPatternIds: ["hook_type:loss_framed"] })));
  fs.writeFileSync(path.join(dir, "broken.json"), "{not json");
  const angles = recentBriefingAngles(dir);
  assert.ok(angles.includes("Manual angle") && angles.includes("FOMO angle") && angles.length === 2);
  const kb = listKbBriefings(dir);
  assert.equal(kb.length, 1); assert.equal(kb[0].id, "kb_1"); assert.deepEqual(kb[0].usedPatternIds, ["hook_type:loss_framed"]); assert.ok(kb[0].file.endsWith("kb_2026_10_21_01_fomo.json"));
  assert.deepEqual(recentBriefingAngles(path.join(dir, "missing")), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Only pattern ids that the KB block lists survive; invented ids are dropped", async () => {
  const { kbPatternIds } = await import("./briefings-from-kb.js");
  const block = '<winning_patterns>\nWhat works:\n- [hook_type:loss_framed] Hook type "loss_framed" ranks 1.6×\n- [pacing:fast (4+ cuts/10s)] Pacing ranks 1.3×\n</winning_patterns>';
  assert.deepEqual([...kbPatternIds(block)], ["hook_type:loss_framed", "pacing:fast (4+ cuts/10s)"]);
  assert.equal(kbPatternIds(undefined).size, 0);
});
