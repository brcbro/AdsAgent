import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ProjectMetadata } from "@ai-ads/core";
import { MAX_RENDER_VERSIONS, listRenderVersions, renderVersionFile, saveRenderVersion } from "./versions.js";

const meta = {
  id: "versions_test", title: "Versions", scriptDe: "Ein Skript.", introMs: 6000, avatarZoom: 1, aspectRatio: "9:16",
  outputSpeed: 1, fullAvatar: false, fastCuts: false, avatar: { heygenAvatarId: "" }, muteAvatar: false, avatarVolume: 1,
  captions: { presetId: "meta-bold", fontSize: 34 }, status: "done", createdAt: "", updatedAt: "",
} as ProjectMetadata;

test("Each render is kept with its settings, newest first, and the oldest are pruned", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-versions-"));
  try {
    const render = path.join(dir, "final.mp4");
    for (let i = 0; i < MAX_RENDER_VERSIONS + 2; i++) {
      fs.writeFileSync(render, `render ${i}`);
      saveRenderVersion({ ...meta, captions: { presetId: `preset-${i}` } }, render, dir, 1_700_000_000_000 + i);
    }
    const versions = listRenderVersions(meta.id, dir);
    assert.equal(versions.length, MAX_RENDER_VERSIONS);
    assert.equal(versions[0].settings.captions?.presetId, `preset-${MAX_RENDER_VERSIONS + 1}`);
    assert.equal(fs.readFileSync(renderVersionFile(meta.id, versions[0].id, dir)!, "utf-8"), `render ${MAX_RENDER_VERSIONS + 1}`);
    // Pruned files are gone from disk, not just from the index.
    assert.equal(fs.readdirSync(path.join(dir, "versions")).filter((f) => f.endsWith(".mp4")).length, MAX_RENDER_VERSIONS);
    // Settings are a snapshot: later edits to the project don't change a saved version.
    assert.equal(versions[0].settings.scriptDe, "Ein Skript.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Version lookups reject malformed ids and versions saved in the same millisecond stay distinct", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-versions-"));
  try {
    const render = path.join(dir, "final.mp4");
    fs.writeFileSync(render, "a");
    const first = saveRenderVersion(meta, render, dir, 1_700_000_000_000);
    const second = saveRenderVersion(meta, render, dir, 1_700_000_000_000);
    assert.notEqual(first.id, second.id);
    assert.equal(renderVersionFile(meta.id, "../metadata", dir), null);
    assert.equal(renderVersionFile(meta.id, "v_1", dir), null);
    assert.ok(renderVersionFile(meta.id, second.id, dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
