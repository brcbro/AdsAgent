import assert from "node:assert/strict";
import test from "node:test";
import { assertScriptCompliant, checkScriptCompliance } from "./compliance.js";

test("blocks guarantees, risk-free claims, and return figures", () => {
  const blocking = (text: string) =>
    checkScriptCompliance(text).filter((f) => f.severity === "block").map((f) => f.rule);
  assert.deepEqual(blocking("Wir garantieren dir Gewinne."), ["guarantee"]);
  assert.deepEqual(blocking("Trading ist risikofrei."), ["risk-free"]);
  assert.deepEqual(blocking("Mit uns machst du 30% Rendite pro Monat."), ["return-figure"]);
  assert.deepEqual(blocking("Werde schnell reich mit unserem System."), ["get-rich"]);
});

test("does not block ordinary training copy", () => {
  const text = "Kein Risikomanagement? Dann lernst du es bei uns. Kein Finfluencer-Hype, echte Methodik.";
  assert.equal(checkScriptCompliance(text).filter((f) => f.severity === "block").length, 0);
});

test("warns on income and certainty wording without blocking", () => {
  const findings = checkScriptCompliance("Sicher handeln und finanziell frei werden.");
  assert.ok(findings.some((f) => f.rule === "certainty" && f.severity === "warn"));
  assert.ok(findings.some((f) => f.rule === "income-claim" && f.severity === "warn"));
  assert.doesNotThrow(() => assertScriptCompliant("Sicher handeln und finanziell frei werden."));
});

test("assertScriptCompliant throws with the offending phrase", () => {
  assert.throws(() => assertScriptCompliant("Das ist garantiert ein Erfolg."), /garantiert/);
});
