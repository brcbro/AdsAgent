import fs from "node:fs";
import path from "node:path";
import { Beat, Segment, adDir } from "@ai-ads/core";
import { pickBrollSequence } from "./broll.js";
import { assignSemanticBroll } from "./broll-match.js";

export type BeatPlanOptions = {
  fullAvatar?: boolean;
  brollCutMs?: number;
  fastCuts?: boolean;
  /** Match B-roll to the script's words instead of cycling clips in order. */
  semantic?: boolean;
  /** Per-project clip choices from the editor. */
  pinned?: string[];
  excluded?: string[];
};

/** Keep rounding remainders from becoming a one-frame flash at the end of a video. */
export function mergeTinyFinalBeat(beats: Beat[], minMs = 400): Beat[] {
  const last = beats.at(-1);
  if (beats.length < 2 || !last || last.endMs - last.startMs >= minMs) return beats;
  return [...beats.slice(0, -2), { ...beats[beats.length - 2], endMs: last.endMs }];
}

function finalizeBeats(
  beats: Beat[],
  seg: Segment,
  adId: string,
  introMs: number,
  brollClips: string[],
  semantic: boolean,
  opts: BeatPlanOptions = {},
): Beat[] {
  const dur = seg.durationMs ?? seg.estimatedMs ?? 30000;
  const stableBeats = mergeTinyFinalBeat(beats);
  const out = semantic
    ? assignSemanticBroll(stableBeats, seg.words, seg.scriptDe, adId, dur, { pinned: opts.pinned, excluded: opts.excluded })
    : stableBeats;
  fs.writeFileSync(
    path.join(adDir(adId), "beats.json"),
    JSON.stringify({ introMs, beats: out, brollClips }, null, 2),
  );
  if (semantic) {
    const matched = out.filter((b) => b.kind === "broll" && b.query).length;
    console.log(`[${adId}] Semantic B-roll: ${matched} cuts matched to script`);
  }
  return out;
}

export function planBeatsForAd(seg: Segment, introMs: number, adId: string, opts: BeatPlanOptions = {}): Beat[] {
  const semantic = opts.semantic === true;
  const dur = seg.durationMs ?? seg.estimatedMs ?? 30000;
  const intro = Math.min(introMs, dur);
  if (opts.fullAvatar || intro >= dur - 500) {
    const beats: Beat[] = [{ startMs: 0, endMs: dur, kind: "talking_head" }];
    return finalizeBeats(beats, seg, adId, dur, [], semantic, opts);
  }

  if (opts.fastCuts) {
    const brollMs = opts.brollCutMs ?? 1000;
    const avatarMs = 2400;
    const clips = pickBrollSequence(adId, 40, opts.excluded);
    const beats: Beat[] = [{ startMs: 0, endMs: Math.min(intro, dur), kind: "talking_head" }];
    let t = beats[0].endMs;
    let clipIdx = 0;
    let brollTurn = true;
    while (t < dur - 300) {
      const len = brollTurn ? brollMs : avatarMs;
      const end = Math.min(t + len, dur);
      if (brollTurn && clips.length) {
        beats.push({
          startMs: t,
          endMs: end,
          kind: "broll",
          clipPath: semantic ? undefined : clips[clipIdx % clips.length],
          clipInMs: Math.floor(Math.random() * 5000),
        });
        clipIdx++;
      } else {
        beats.push({ startMs: t, endMs: end, kind: "talking_head" });
      }
      t = end;
      brollTurn = !brollTurn;
    }
    if (t < dur) {
      beats.push({ startMs: t, endMs: dur, kind: "talking_head" });
    }
    return finalizeBeats(beats, seg, adId, intro, clips.slice(0, clipIdx), semantic, opts);
  }

  const beats: Beat[] = [{ startMs: 0, endMs: intro, kind: "talking_head" }];
  const cutMs = opts.brollCutMs ?? 1800;
  const brollCount = Math.ceil((dur - introMs) / cutMs);
  const clips = pickBrollSequence(adId, Math.max(brollCount, 1), opts.excluded);

  let t = Math.min(introMs, dur);
  let i = 0;
  while (t < dur && clips.length > 0) {
    const end = Math.min(t + cutMs, dur);
    const clip = clips[i % clips.length];
    const clipInMs = Math.floor(Math.random() * 3000);
    beats.push({
      startMs: t,
      endMs: end,
      kind: "broll",
      clipPath: semantic ? undefined : clip,
      clipInMs,
    });
    t = end;
    i++;
  }

  return finalizeBeats(beats, seg, adId, introMs, clips.slice(0, i), semantic, opts);
}
