import assert from "node:assert/strict";
import test from "node:test";
import { mergeTinyFinalBeat } from "./beat-plan.js";
test("A rounded 20ms final cut extends the previous shot instead of flashing another clip", () => {
  const beats = [{ kind: "talking_head" as const, startMs: 0, endMs: 3000 },
    { kind: "broll" as const, startMs: 3000, endMs: 4800, clipPath: "keep.mp4" },
    { kind: "broll" as const, startMs: 4800, endMs: 4820, clipPath: "flash.mp4" }];
  const stable = mergeTinyFinalBeat(beats);
  assert.equal(stable.length, 2); assert.equal(stable[1].endMs, 4820); assert.equal(stable[1].clipPath, "keep.mp4");
  assert.equal(stable[1].startMs, stable[0].endMs); assert.equal(beats.length, 3);
  assert.equal(mergeTinyFinalBeat([{ kind: "talking_head", startMs: 0, endMs: 20 }]).length, 1);
  assert.equal(mergeTinyFinalBeat([...beats.slice(0, 2), { ...beats[2], endMs: 5300 }]).length, 3);
});
