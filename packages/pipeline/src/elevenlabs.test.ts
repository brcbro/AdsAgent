import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { synthesize } from "./elevenlabs.js";

test("v4 German generation persists alignment; auth failures make no duplicate request", async (t) => {
  const originalFetch = globalThis.fetch;
  const names = ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL", "ELEVENLABS_LANGUAGE"];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-tts-test-"));
  const audio = path.join(dir, "main.mp3");
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
    for (const filename of ["main.mp3", "main.tts.json"]) {
      const file = path.join(dir, filename);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  });
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.ELEVENLABS_VOICE_ID = "german-voice";
  delete process.env.ELEVENLABS_MODEL;
  delete process.env.ELEVENLABS_LANGUAGE;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /german-voice\/with-timestamps/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model_id, "eleven_v4");
    assert.equal(body.language_code, "de");
    return Response.json({ audio_base64: Buffer.from("test-audio").toString("base64"), normalized_alignment: {
      characters: ["H", "i"], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2],
    } });
  };
  const result = await synthesize("Hi", audio);
  assert.equal(calls, 1);
  assert.deepEqual(result.words, [{ word: "Hi", startMs: 0, endMs: 200 }]);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "main.tts.json"), "utf8"));
  assert.equal(saved.modelId, "eleven_v4");
  assert.equal(saved.scriptDe, "Hi");
  assert.deepEqual(saved.words, result.words);

  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ detail: { message: "Unauthorized" } }, { status: 401 });
  };
  await assert.rejects(synthesize("Hi", audio), /ElevenLabs TTS failed: 401/);
  assert.equal(calls, 1);
});
