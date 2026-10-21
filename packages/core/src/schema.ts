import { z } from "zod";

export const SegmentRole = z.enum(["hook", "body", "cta"]);
export type SegmentRole = z.infer<typeof SegmentRole>;

export const WordTimestamp = z.object({
  word: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});
export type WordTimestamp = z.infer<typeof WordTimestamp>;

export const BeatKind = z.enum(["talking_head", "broll"]);

export const Beat = z.object({
  startMs: z.number(),
  endMs: z.number(),
  kind: BeatKind,
  // Search query / description for broll beats; ignored for talking_head
  query: z.string().optional(),
  // Resolved clip, relative to the remotion public dir
  clipPath: z.string().optional(),
  clipInMs: z.number().optional(),
});
export type Beat = z.infer<typeof Beat>;

export const Segment = z.object({
  id: z.string(),
  role: SegmentRole,
  scriptDe: z.string(),
  // Estimated from char count before TTS; replaced by real duration after
  estimatedMs: z.number().optional(),
  durationMs: z.number().optional(),
  audioPath: z.string().optional(),
  avatarPath: z.string().optional(),
  words: z.array(WordTimestamp).optional(),
  beats: z.array(Beat).default([]),
});
export type Segment = z.infer<typeof Segment>;

export const Briefing = z.object({
  id: z.string(),
  angle: z.string(),
  persona: z.string(),
  painPoint: z.string(),
  promise: z.string(),
  tone: z.string(),
  visualDirection: z.array(z.string()),
  hookConcepts: z.array(z.string()).min(1),
  bodyConcept: z.string(),
  ctaConcepts: z.array(z.string()).min(1),
  source: z.enum(["manual", "meta-analysis", "chat"]).default("manual"),
});
export type Briefing = z.infer<typeof Briefing>;

export const AdState = z.enum([
  "briefing",
  "script_review",
  "generating",
  "assembly",
  "final_review",
  "exported",
]);

export const AdProject = z.object({
  id: z.string(),
  briefing: Briefing,
  segments: z.object({
    hooks: z.array(Segment),
    body: Segment,
    ctas: z.array(Segment),
  }),
  state: AdState,
  createdAt: z.string(),
});
export type AdProject = z.infer<typeof AdProject>;

// Duration budgets (ms) for a 24–30s ad. German ad-read pace ≈ 14 chars/sec.
export const DURATION_BUDGET = {
  hook: { min: 3000, max: 6000, maxChars: 85 },
  body: { min: 14000, max: 18000, maxChars: 250 },
  cta: { min: 4000, max: 6000, maxChars: 85 },
} as const;

export const CHARS_PER_SECOND_DE = 14;

export function estimateDurationMs(scriptDe: string): number {
  return Math.round((scriptDe.length / CHARS_PER_SECOND_DE) * 1000);
}
