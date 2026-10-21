import assert from "node:assert/strict";
import test from "node:test";
import type { Beat } from "@ai-ads/core";
import { assignSemanticBroll, pickClip, type BrollCatalogEntry } from "./broll-match.js";

const catalog: BrollCatalogEntry[] = [
  { file: "/Trading/chart.mp4", name: "chart.mp4", preview: "", category: "Trading", tags: ["chart"] },
  { file: "/Lifestyle/beach.mp4", name: "beach.mp4", preview: "", category: "Lifestyle", tags: ["beach"] },
];

test("Trading scripts select relevant footage across different ad IDs", () => {
  for (let i = 0; i < 30; i++) {
    const clip = pickClip("Aktienmarkt und Trading", catalog, new Set(), `ad_${i}`, i);
    assert.equal(clip?.category, "Trading");
  }
});

test("Avoid repeated clips until the available library is exhausted", () => {
  const used = new Set([catalog[0].file]);
  assert.equal(pickClip("Trading", catalog, used, "ad", 1)?.file, catalog[1].file);
  used.add(catalog[1].file);
  assert.equal(pickClip("Trading", catalog, used, "ad", 2)?.file, catalog[0].file);
  assert.equal(pickClip("Trading", [], used, "ad", 3), null);
});

test("Pinned clips always appear, on the beat they match best; excluded clips never appear", () => {
  const library: BrollCatalogEntry[] = [
    { file: "/Trading/chart.mp4", name: "chart.mp4", preview: "", category: "Trading", tags: ["chart"] },
    { file: "/Trading/candles.mp4", name: "candles.mp4", preview: "", category: "Trading", tags: ["candles"] },
    { file: "/Lifestyle/beach.mp4", name: "beach.mp4", preview: "", category: "Lifestyle", tags: ["beach"] },
    { file: "/Community/team.mp4", name: "team.mp4", preview: "", category: "Community", tags: ["team"] },
  ];
  const beats: Beat[] = [
    { startMs: 0, endMs: 2000, kind: "talking_head" },
    { startMs: 2000, endMs: 4000, kind: "broll" },
    { startMs: 4000, endMs: 6000, kind: "broll" },
    { startMs: 6000, endMs: 8000, kind: "broll" },
  ];
  const script = "Hallo zusammen. Trading und Charts verstehen. Freiheit und Reisen am Strand. Werde Teil der Community.";
  for (let i = 0; i < 20; i++) {
    const out = assignSemanticBroll(beats, undefined, script, `ad_${i}`, 8000, {
      catalog: library, pinned: ["/Lifestyle/beach.mp4"], excluded: ["/Trading/chart.mp4"],
    });
    const clips = out.filter((b) => b.kind === "broll").map((b) => b.clipPath);
    assert.ok(clips.includes("/Lifestyle/beach.mp4"), "pinned clip is used");
    assert.ok(!clips.includes("/Trading/chart.mp4"), "excluded clip is never used");
    assert.equal(new Set(clips).size, clips.length, "no clip repeats while others are available");
  }
});
