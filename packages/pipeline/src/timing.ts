import type { WordTimestamp } from "@ai-ads/core";

/** Spread word timings by character count when no real alignment is available. */
export function proportionalWords(text: string, durationMs: number): WordTimestamp[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const totalChars = tokens.reduce((sum, w) => sum + w.length + 1, 0);
  let cursor = 0;
  return tokens.map((word) => {
    const startMs = Math.round((cursor / totalChars) * durationMs);
    cursor += word.length + 1;
    const endMs = Math.round((cursor / totalChars) * durationMs);
    return { word, startMs, endMs };
  });
}

/**
 * When the hook (the script's first sentence) finishes, so the presenter can hand over to B-roll there.
 * Clamped to 1.5–10 s and always leaves at least 1.5 s of B-roll; falls back to `fallbackMs`.
 */
export function hookEndMs(words: WordTimestamp[] | undefined, durationMs: number, fallbackMs: number): number {
  const sentenceEnd = words?.find((w) => /[.!?…]["»“”']?$/.test(w.word));
  const raw = sentenceEnd ? sentenceEnd.endMs + 150 : fallbackMs;
  return Math.max(1500, Math.min(raw, 10_000, Math.max(1500, durationMs - 1500)));
}

function srtTimeMs(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  if (!m) return NaN;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, "0").slice(0, 3));
}

/**
 * Word timings from an SRT file (HeyGen's sidecar for its own voices): each cue's span is exact,
 * words inside a cue are spread by character count. Returns [] when nothing usable is found.
 */
export function wordsFromSrt(srt: string, durationMs?: number): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split("-->");
    const start = srtTimeMs(a); const end = srtTimeMs(b);
    const text = lines.slice(timeIdx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
    for (const w of proportionalWords(text, end - start)) words.push({ word: w.word, startMs: start + w.startMs, endMs: start + w.endMs });
  }
  words.sort((x, y) => x.startMs - y.startMs);
  if (durationMs) for (const w of words) { w.startMs = Math.min(w.startMs, durationMs); w.endMs = Math.min(w.endMs, durationMs); }
  return words;
}
