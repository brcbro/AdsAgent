import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireIngestLock, classificationPrompt, classifyClip, decideCategory, isManualRenderActive, isStableFile, mergeTags,
  normalizeCategory, releaseIngestLock, LOCK_STALE_MS, STABLE_MS,
} from "./broll-classify.js";
import { safeClipName, uniqueDestination } from "./broll.js";
import { userContent } from "./llm.js";

const KNOWN = ["Trading", "Lifestyle", "Deep Work", "Community"];

test("model answers map onto known categories regardless of case and punctuation", () => {
  assert.equal(normalizeCategory("deep work", KNOWN), "Deep Work");
  assert.equal(normalizeCategory("Deep-Work", KNOWN), "Deep Work");
  assert.equal(normalizeCategory("TRADING", KNOWN), "Trading");
  assert.equal(normalizeCategory("Lifestyle footage", KNOWN), "Lifestyle");
  assert.equal(normalizeCategory("Sports", KNOWN), null);
  assert.equal(normalizeCategory("", KNOWN), null);
});

test("low confidence or an unknown category flags the clip for review", () => {
  assert.deepEqual(decideCategory("Trading", 0.92, KNOWN, 0.7), { category: "Trading", confidence: 0.92, needsReview: false });
  assert.deepEqual(decideCategory("Trading", 0.4, KNOWN, 0.7), { category: "Trading", confidence: 0.4, needsReview: true });
  assert.deepEqual(decideCategory("Cooking", 0.99, KNOWN, 0.7), { category: "Other", confidence: 0.99, needsReview: true });
  assert.deepEqual(decideCategory("Trading", Number.NaN, KNOWN, 0.7), { category: "Trading", confidence: 0, needsReview: true });
  assert.equal(decideCategory("Trading", 0.7, KNOWN, 0.7).needsReview, false);
});

test("classifyClip sends the sampled frames and the category list to the model", async () => {
  const seen: { system?: string; images?: unknown[]; model?: string } = {};
  const result = await classifyClip("/clips/x.mp4", KNOWN, {
    frames: async () => [{ mediaType: "image/jpeg", base64: "AAAA" }, { mediaType: "image/jpeg", base64: "BBBB" }],
    chat: (async (opts: { system: string; images?: unknown[]; model?: string }) => {
      seen.system = opts.system; seen.images = opts.images; seen.model = opts.model;
      return { category: "Community", confidence: 0.8, tags: ["people"], description: "Two people talk." };
    }) as never,
  });
  assert.equal(result.category, "Community");
  assert.equal(seen.images?.length, 2);
  assert.match(seen.system!, /Deep Work/);
  assert.match(seen.system!, /Community/);
  assert.match(classificationPrompt(["Trading"]).system, /- Trading: trading charts/);
});

test("image blocks follow each provider's content format", () => {
  const images = [{ mediaType: "image/jpeg" as const, base64: "QUJD" }];
  assert.equal(userContent("anthropic", "hi"), "hi");
  const claude = userContent("anthropic", "hi", images) as Array<Record<string, unknown>>;
  assert.deepEqual(claude[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  assert.deepEqual(claude[1], { type: "text", text: "hi" });
  const router = userContent("openrouter", "hi", images) as Array<Record<string, unknown>>;
  assert.deepEqual(router[0], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
});

test("tags merge the file name with the model's tags, lowercase and unique", () => {
  assert.deepEqual(mergeTags("Beach_Walk__x1.mp4", ["Beach", " sunset ", "x"]), ["beach", "walk", "sunset"]);
});

test("safe names and de-duplicated destinations", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-test-"));
  try {
    assert.equal(safeClipName("../..\\Mein Clip (1).MP4"), "Mein_Clip_1_.MP4");
    assert.equal(safeClipName("   "), safeClipName("   ")); // deterministic fallback shape
    assert.equal(uniqueDestination(dir, "a.mp4"), path.join(dir, "a.mp4"));
    fs.writeFileSync(path.join(dir, "a.mp4"), "x");
    assert.equal(uniqueDestination(dir, "a.mp4"), path.join(dir, "a-2.mp4"));
    fs.writeFileSync(path.join(dir, "a-2.mp4"), "x");
    assert.equal(uniqueDestination(dir, "a.mp4"), path.join(dir, "a-3.mp4"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a file is stable only once it has content and stopped changing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-test-"));
  try {
    const file = path.join(dir, "clip.mp4");
    fs.writeFileSync(file, "");
    const now = Date.now();
    assert.equal(isStableFile(file, now + STABLE_MS * 2), false, "empty files are never stable");
    fs.writeFileSync(file, "data");
    assert.equal(isStableFile(file, Date.now()), false, "just written");
    assert.equal(isStableFile(file, Date.now() + STABLE_MS + 10), true);
    assert.equal(isStableFile(path.join(dir, "missing.mp4")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the ingest lock is single-instance, takes over stale locks and respects the manual render lock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "broll-test-"));
  try {
    const lock = path.join(dir, "broll-ingest.lock");
    assert.equal(acquireIngestLock("a", lock), true);
    assert.equal(acquireIngestLock("b", lock), false, "held by a");
    assert.equal(acquireIngestLock("a", lock), true, "re-entrant for the owner");
    assert.equal(acquireIngestLock("b", lock, Date.now() + LOCK_STALE_MS + 1), true, "stale locks are taken over");
    releaseIngestLock("a", lock);
    assert.equal(fs.existsSync(lock), true, "a no longer owns it");
    releaseIngestLock("b", lock);
    assert.equal(fs.existsSync(lock), false);

    const render = path.join(dir, "manual-render.lock");
    assert.equal(isManualRenderActive(render), false);
    fs.writeFileSync(render, String(Date.now()));
    assert.equal(isManualRenderActive(render), true);
    assert.equal(isManualRenderActive(render, Date.now() + LOCK_STALE_MS + 1), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
