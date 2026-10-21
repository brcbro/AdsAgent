import assert from "node:assert/strict";
import test from "node:test";
import { toSpokenGerman } from "./pronunciation.js";

test("spells out symbols and abbreviations for TTS", () => {
  assert.equal(toSpokenGerman("Nur 5% und 100€ im CFD-Training."), "Nur 5 Prozent und 100 Euro im C F D-Training.");
  assert.equal(toSpokenGerman("Z.B. Trading & Risiko, bzw. ETF, ca. 3 Monate."),
    "zum Beispiel Trading und Risiko, beziehungsweise E T F, circa 3 Monate.");
});

test("leaves plain German untouched", () => {
  const text = "Starte heute mit Struktur statt Bauchgefühl.";
  assert.equal(toSpokenGerman(text), text);
});
