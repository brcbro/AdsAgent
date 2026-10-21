import assert from "node:assert/strict";
import test from "node:test";
import { assessVideoQuality, type QualityInput } from "./video-quality.js";
const sample: QualityInput = { duration: 20, width: 1080, height: 1920, hasAudio: true, decoded: true, meanDb: -22, peakDb: -2,
  targetSeconds: 20, portrait: true, captionBottom: 30, sourcesExist: true,
  words: [{ word: "Hallo", startMs: 0, endMs: 600 }], beats: [{ kind: "talking_head", startMs: 0, endMs: 3000 }, { kind: "broll", startMs: 3000, endMs: 20_000, clipPath: "test.mp4" }] };
test("Valid media and timeline pass; duration mismatch remains a visible warning", () => {
  assert.equal(assessVideoQuality(sample).passed, true);
  const report = assessVideoQuality({ ...sample, targetSeconds: 40 });
  assert.equal(report.passed, true); assert.equal(report.checks.find(c => c.name === "Target duration")?.result, "warn");
});
test("Corrupt video, silent audio, invalid captions, missing footage and timeline gaps fail", () => {
  for (const patch of [{ decoded: false }, { hasAudio: false }, { meanDb: -70 }, { sourcesExist: false }, { words: [] },
    { words: [{ word: "Bad", startMs: 500, endMs: 200 }] }, { captionBottom: 3 }, { beats: [{ kind: "broll" as const, startMs: 2000, endMs: 20_000 }] }]) {
    assert.equal(assessVideoQuality({ ...sample, ...patch }).passed, false);
  }
});
