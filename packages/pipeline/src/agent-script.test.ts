import assert from "node:assert/strict";
import test from "node:test";
import { winningPatternsInstruction } from "./agent-script.js";

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
