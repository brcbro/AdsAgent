import assert from "node:assert/strict";
import test from "node:test";
import { hookEndMs, proportionalWords, wordsFromSrt } from "./timing.js";

const SRT = `1
00:00:00,000 --> 00:00:01,800
Trading braucht klare Regeln.

2
00:00:02,000 --> 00:00:05,000
Plane dein Risiko, bevor du handelst.
`;

test("SRT cues give exact spans; words inside a cue are spread by length", () => {
  const words = wordsFromSrt(SRT);
  assert.deepEqual(words.map((w) => w.word), ["Trading", "braucht", "klare", "Regeln.", "Plane", "dein", "Risiko,", "bevor", "du", "handelst."]);
  assert.equal(words[0].startMs, 0);
  assert.equal(words[3].endMs, 1800);
  assert.equal(words[4].startMs, 2000);
  assert.equal(words.at(-1)!.endMs, 5000);
  for (let i = 1; i < words.length; i++) assert.ok(words[i].startMs >= words[i - 1].startMs);
});

test("SRT parsing tolerates CRLF and markup, and clamps to the clip length", () => {
  const words = wordsFromSrt(SRT.replace(/\n/g, "\r\n").replace("Plane", "<i>Plane</i>"), 4000);
  assert.equal(words[4].word, "Plane");
  assert.ok(words.every((w) => w.endMs <= 4000));
  assert.deepEqual(wordsFromSrt("not a subtitle file"), []);
});

test("hook ends with the first sentence and leaves room for B-roll", () => {
  const words = wordsFromSrt(SRT);
  assert.equal(hookEndMs(words, 5000, 6000), 1950);
  // No sentence end: the fixed length is used, clamped so B-roll still gets 1.5 s.
  assert.equal(hookEndMs(proportionalWords("ohne Punkt am Ende", 20000), 20000, 6000), 6000);
  assert.equal(hookEndMs(undefined, 5000, 9000), 3500);
  // A very long first sentence is capped at 10 s.
  assert.equal(hookEndMs([{ word: "Lang.", startMs: 0, endMs: 14000 }], 30000, 6000), 10000);
});
