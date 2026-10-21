import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import type { JobStatus, ProjectStatus } from "./types";

// Our custom text sizes share the "text-" prefix with colours; register them so they don't cancel out.
const merge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["xs", "sm", "base", "lg", "xl", "2xl"] }] } },
});

/** Join class names; later classes win over conflicting earlier ones (e.g. a caller's bg-* over a variant's). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return merge(clsx(parts));
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 min ago", "yesterday", then a short date. */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** 0:07, 1:23 — playback timecodes. */
export function timecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 42s, 3m 05s — elapsed render time. */
export function elapsed(fromIso: string | null | undefined, now = Date.now()): string {
  if (!fromIso) return "";
  const total = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  generating: { label: "Generating", tone: "accent" },
  rendering: { label: "Rendering", tone: "accent" },
  done: { label: "Ready", tone: "success" },
  error: { label: "Failed", tone: "danger" },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "accent" },
  script_review: { label: "Script review", tone: "warning" },
  needs_review: { label: "Needs review", tone: "warning" },
  done: { label: "Done", tone: "success" },
  error: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export function isBusy(status: ProjectStatus | undefined): boolean {
  return status === "generating" || status === "rendering";
}

/** German narration averages ~2.4 words per second with ElevenLabs at normal pace. */
const WORDS_PER_SECOND = 2.4;

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function spokenSeconds(text: string, speed = 1): number {
  return wordCount(text) / WORDS_PER_SECOND / (speed || 1);
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+["“”»]?|[^.!?…]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Human-friendly clip title from a catalog file name ("trading_chart__abc.mp4" → "trading chart"). */
export function clipTitle(name: string): string {
  return name.replace(/__.*(?=\.[^.]+$)/, "").replace(/\.[^.]+$/, "").replace(/_/g, " ");
}

/** Default title for a new project derived from the first words of its script. */
export function titleFromScript(script: string): string {
  const words = script.trim().split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:!?—–-]+$/, "");
  return words || "Untitled video";
}
