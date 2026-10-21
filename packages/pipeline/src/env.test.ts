import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRepoEnv } from "../../core/src/env.js";

test("loadRepoEnv reads KEY=VALUE pairs without overriding real environment", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "# comment\nENV_TEST_NEW=hello\nENV_TEST_QUOTED=\"quoted value\"\nENV_TEST_KEEP=from-file\n");
  process.env.ENV_TEST_KEEP = "from-shell";
  t.after(() => {
    for (const k of ["ENV_TEST_NEW", "ENV_TEST_QUOTED", "ENV_TEST_KEEP"]) delete process.env[k];
    fs.rmSync(dir, { recursive: true, force: true });
  });
  loadRepoEnv(file);
  assert.equal(process.env.ENV_TEST_NEW, "hello");
  assert.equal(process.env.ENV_TEST_QUOTED, "quoted value");
  assert.equal(process.env.ENV_TEST_KEEP, "from-shell");
});
