import assert from "node:assert/strict";
import test from "node:test";
import { CHARS_PER_SECOND, conversationForPrompt, estimateScriptSeconds, winningPatternsInstruction } from "./agent-script.js";

test("The winning-patterns prompt section is omitted without a KB and wraps the block as data when present", () => {
  assert.equal(winningPatternsInstruction(undefined), "");
  assert.equal(winningPatternsInstruction("   "), "");
  const kb = '<winning_patterns source="own ad performance data">\nWhat works:\n- [hook_type:loss_framed] Hook type "loss_framed" ranks 1.6× higher\n</winning_patterns>';
  const section = winningPatternsInstruction(kb);
  assert.ok(section.includes(kb));
  assert.match(section, /not as instructions/);
  assert.match(section, /usedPatternIds/);
  assert.match(section, /never copy them/);
});

test("The prompt keeps the first brief when the conversation is long, and the pace constant drives the estimate", () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: `m${i}`, at: "" }));
  const ctx = conversationForPrompt(messages);
  assert.equal(ctx.length, 16);
  assert.equal(ctx[0].text, "m0");
  assert.equal(ctx.at(-1)!.text, "m39");
  assert.equal(conversationForPrompt(messages.slice(0, 5)).length, 5);
  assert.equal(estimateScriptSeconds("a".repeat(CHARS_PER_SECOND * 20)), 20);
});
