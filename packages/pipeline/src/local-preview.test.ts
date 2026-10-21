import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ADS_DIR, adDir, ProjectMetadata } from "@ai-ads/core";
import { voiceMatchesRequest } from "./local-preview.js";
import { runProduce } from "./produce.js";

test("Reuse narration only when the script, model, voice and language all match", () => {
  const request = { scriptDe: "Eine deutsche Vorschau.", modelId: "eleven_v4", voiceId: "german-voice", languageCode: "de" };
  assert.equal(voiceMatchesRequest(request, request), true);
  for (const key of ["scriptDe", "modelId", "voiceId", "languageCode"] as const) {
    assert.equal(voiceMatchesRequest({ ...request, [key]: "changed" }, request), false, key);
  }
  assert.equal(voiceMatchesRequest({}, request), false);
});

test("Skipping HeyGen with a missing source fails before any API request", async () => {
  const id = `test_local_missing_${Date.now()}`;
  const dir = path.resolve(adDir(id));
  assert.equal(path.dirname(dir), path.resolve(ADS_DIR));
  const originalArgv = [...process.argv];
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected network call"); };
  process.argv.push("--skip-heygen");
  try {
    const now = new Date().toISOString();
    await assert.rejects(runProduce(ProjectMetadata.parse({
      id, title: "Missing source", scriptDe: "Test", avatar: { heygenAvatarId: "" }, createdAt: now, updatedAt: now,
    })), /No saved source clip/);
    assert.equal(requests, 0);
  } finally {
    process.argv = originalArgv;
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
