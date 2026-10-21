/**
 * Spoken German for TTS. Only the request text changes: the stored script keeps
 * the written form, and captions show whatever ElevenLabs actually spoke.
 */
const RULES: Array<[RegExp, string]> = [
  [/(\d)\s*%/g, "$1 Prozent"],
  [/€/g, " Euro"],
  [/\$/g, " Dollar"],
  [/&/g, " und "],
  [/\bCFD\b/g, "C F D"],
  [/\bETF\b/g, "E T F"],
  [/\bROI\b/g, "R O I"],
  [/\bKI\b/g, "K I"],
  [/\b[zZ]\.\s?[bB]\./g, "zum Beispiel"],
  [/\bbzw\./g, "beziehungsweise"],
  [/\bca\./g, "circa"],
  [/\binkl\./g, "inklusive"],
];

export function toSpokenGerman(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, " ").trim();
}
