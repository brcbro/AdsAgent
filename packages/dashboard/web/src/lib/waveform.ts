import { useEffect, useState } from "react";

const BARS = 64;
const cache = new Map<string, Promise<number[]>>();

/** Loudness per bar (0–1), decoded once per URL and shared by every component that asks. */
function loadPeaks(url: string): Promise<number[]> {
  let pending = cache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio not available (${response.status})`);
      // An offline context decodes without needing a user gesture (unlike AudioContext).
      const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await response.arrayBuffer());
      const data = audio.getChannelData(0);
      const size = Math.floor(data.length / BARS);
      // RMS loudness per bar (every 16th sample is plenty for an overview). Peaks would read as a flat
      // block on mastered music, so the range is stretched to make the track's structure visible.
      const levels = Array.from({ length: BARS }, (_, i) => {
        let sum = 0;
        let n = 0;
        for (let j = i * size; j < (i + 1) * size; j += 16) { sum += data[j] * data[j]; n++; }
        return Math.sqrt(sum / Math.max(n, 1));
      });
      const max = Math.max(...levels);
      const min = Math.min(...levels);
      const range = max - min || 1;
      return levels.map((v) => 0.15 + 0.85 * ((v - min) / range));
    })();
    // Failed decodes are retried on the next request instead of being cached forever.
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}

export function useWaveform(url: string | undefined, enabled: boolean): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!url || !enabled) return;
    let alive = true;
    loadPeaks(url).then((p) => { if (alive) setPeaks(p); }, () => { if (alive) setPeaks(null); });
    return () => { alive = false; };
  }, [url, enabled]);
  return peaks;
}
