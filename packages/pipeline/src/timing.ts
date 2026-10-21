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
