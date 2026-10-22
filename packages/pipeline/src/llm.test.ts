import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { chatJson, extractJson } from "./llm.js";

const opts = { schema: z.object({ scriptDe: z.string() }), schemaName: "test_script", system: "Write a script", user: "German test" };

test("Claude and OpenRouter transport, JSON repair, and authentication errors", async (t) => {
  const originalFetch = globalThis.fetch;
  const names = ["LLM_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENROUTER_API_KEY"];
  const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_MODEL = "claude-haiku-5-5";

  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal(body.messages[0].role, "user");
    assert.ok(body.system);
    if (calls === 2) assert.match(body.messages[0].content, /gültiges JSON/);
    return Response.json({ content: [{ type: "thinking", text: "ignored" }, { type: "text", text: calls === 1 ? '{"scriptDe":123}' : '{"scriptDe":"Hallo"}' }], stop_reason: "end_turn" });
  };
  assert.deepEqual(await chatJson(opts), { scriptDe: "Hallo" });
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: "Invalid test-key" } }, { status: 401 });
  };
  await assert.rejects(chatJson(opts), /anthropic 401: Invalid \[redacted\]/);
  assert.equal(calls, 1);

  process.env.LLM_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "router-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer router-key");
    assert.ok(JSON.parse(String(init?.body)).response_format.json_schema);
    return Response.json({ choices: [{ message: { content: '{"scriptDe":"Hallo Router"}' } }] });
  };
  assert.deepEqual(await chatJson(opts), { scriptDe: "Hallo Router" });
});

test("the last JSON object wins when the model echoes the schema or adds prose", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJson("{\"type\":\"object\"}\n\nHere is the answer:\n\n{\"category\":\"Trading\",\"tags\":[\"a\",\"b\"]}"), { category: "Trading", tags: ["a", "b"] });
  assert.deepEqual(extractJson('Sure: {"nested":{"x":"}"}} done'), { nested: { x: "}" } });
  assert.throws(() => extractJson("no json here"), /No JSON object/);
});
