import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateAvatarClip, isPublicHeyGenAvatar, listPublicAvatars } from "./heygen.js";

test("v3 catalog follows cursors, maps look IDs, retains public UUIDs and rejects broken pagination", async t => {
  const original = globalThis.fetch; const key = process.env.HEYGEN_API_KEY;
  t.after(() => { globalThis.fetch = original; if (key === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = key; });
  process.env.HEYGEN_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v3/avatars/looks"); assert.equal(parsed.searchParams.get("ownership"), "public");
    assert.equal(parsed.searchParams.get("avatar_type"), "studio_avatar");
    return Response.json(parsed.searchParams.has("token")
      ? { data: [{ id: "a", name: "A" }, { id: "b", name: "B" }], has_more: false }
      : { data: [{ id: "a", name: "A" }, { id: "abcdef0123456789abcdef0123456789", name: "Public photo" }], has_more: true, next_token: "page2" });
  };
  const avatars = await listPublicAvatars();
  assert.equal(calls, 2); assert.equal(avatars.length, 3); assert.equal(isPublicHeyGenAvatar(avatars[1]), true);
  globalThis.fetch = async () => Response.json({ data: [], has_more: true });
  await assert.rejects(listPublicAvatars(), /pagination did not advance/);
});

test("v3 multipart upload and idempotent submission persist; retry resumes the existing video", async t => {
  const original = globalThis.fetch; const key = process.env.HEYGEN_API_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heygen-v3-test-"));
  const audio = path.join(dir, "voice.mp3"); const out = path.join(dir, "avatar.mp4");
  fs.writeFileSync(audio, "mock audio");
  t.after(() => {
    globalThis.fetch = original; if (key === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = key;
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.HEYGEN_API_KEY = "test-key";
  let uploads = 0; let submissions = 0; let polls = 0; const requestKeys: string[] = [];
  globalThis.fetch = async (url, init) => {
    const p = new URL(String(url)).pathname;
    if (p === "/v3/avatars/looks/presenter") return Response.json({ data: { id: "presenter", name: "Presenter", supported_api_engines: ["avatar_iv"] } });
    if (p === "/v3/users/me") return Response.json({ data: { billing_type: "wallet", wallet: { remaining_balance: 15, currency: "usd" } } });
    if (p === "/v3/assets") {
      uploads++; assert.ok(init?.body instanceof FormData); assert.ok(init.body.get("file"));
      return Response.json({ data: { asset_id: "audio-asset" } });
    }
    if (p === "/v3/videos") {
      submissions++; requestKeys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.audio_asset_id, "audio-asset"); assert.equal(body.script, undefined);
      assert.equal(body.avatar_id, "presenter"); assert.equal(body.aspect_ratio, "9:16"); assert.equal(body.resolution, "1080p");
      if (submissions === 1) throw new Error("Connection lost after submit");
      return Response.json({ data: { video_id: "saved-video" } });
    }
    if (p === "/v3/videos/saved-video") { polls++; return Response.json({ data: { status: "failed", error: { message: "Mock render failure" } } }); }
    throw new Error(`Unexpected endpoint: ${p}`);
  };
  await assert.rejects(generateAvatarClip(audio, out, { avatarId: "presenter" }), /Connection lost/);
  await assert.rejects(generateAvatarClip(audio, out, { avatarId: "presenter" }), /Mock render failure/);
  await assert.rejects(generateAvatarClip(audio, out, { avatarId: "presenter" }), /Mock render failure/);
  assert.equal(uploads, 1); assert.equal(submissions, 2); assert.equal(polls, 2); assert.equal(requestKeys[0], requestKeys[1]);
  const saved = JSON.parse(fs.readFileSync(`${out}.heygen.json`, "utf8")); assert.equal(saved.videoId, "saved-video");
});
