import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adDir, finalVideoFile, type Beat, type ProjectMetadata, type WordTimestamp } from "@ai-ads/core";
import { resolveFfmpegBin } from "./ffmpeg-render.js";

const run = promisify(execFile);
export interface QualityCheck { name: string; result: "pass" | "warn" | "fail"; detail: string }
export interface QualityReport { passed: boolean; checkedAt: string; durationSeconds: number; checks: QualityCheck[] }
export interface QualityInput {
  duration: number; width: number; height: number; hasAudio: boolean; decoded: boolean;
  meanDb: number; peakDb: number; targetSeconds: number; portrait: boolean;
  words: WordTimestamp[]; beats: Beat[]; sourcesExist: boolean; captionBottom: number;
}
export function assessVideoQuality(input: QualityInput): QualityReport {
  const checks: QualityCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, result: ok ? "pass" : "fail", detail });
  add("Playable video", input.decoded && Number.isFinite(input.duration) && input.duration > 0,
    input.decoded ? "Full file decoded with FFmpeg" : "FFmpeg could not fully decode the file");
  add("Video format", input.width === (input.portrait ? 1080 : 1920) && input.height === (input.portrait ? 1920 : 1080), `${input.width} × ${input.height}`);
  add("Audible audio", input.hasAudio && Number.isFinite(input.meanDb) && input.meanDb > -45, `Mean ${input.meanDb.toFixed(1)} dB; peak ${input.peakDb.toFixed(1)} dB`);
  if (input.peakDb > -0.1) checks.push({ name: "Audio headroom", result: "warn", detail: "Audio reaches the maximum level; listen for distortion" });
  const durationMatch = Math.abs(input.duration - input.targetSeconds) <= Math.max(3, input.targetSeconds * 0.35);
  checks.push({ name: "Target duration", result: durationMatch ? "pass" : "warn", detail: `${input.duration.toFixed(1)}s actual / ${input.targetSeconds}s requested` });
  const validWords = input.words.length > 0 && input.words.every((w, i) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.startMs >= 0 && w.endMs > w.startMs && w.endMs <= input.duration * 1000 + 500 && (!i || w.startMs >= input.words[i - 1].startMs));
  add("Caption timing", validWords, `${input.words.length} timed words checked for order and bounds`);
  add("Caption safe area", input.captionBottom >= 15 && input.captionBottom <= 75, `Caption baseline ${input.captionBottom}% from bottom`);
  const broll = input.beats.filter(b => b.kind === "broll");
  add("B-roll footage", broll.length > 0 && input.sourcesExist, `${broll.length} cuts; source files checked`);
  const timeline = input.beats.length > 0 && input.beats[0].startMs === 0 && input.beats.every((b, i) => b.endMs > b.startMs && (!i || Math.abs(b.startMs - input.beats[i - 1].endMs) <= 67)) && Math.abs((input.beats.at(-1)?.endMs || 0) - input.duration * 1000) < 500;
  add("Timeline coverage", timeline, timeline ? "No gaps or invalid segment ranges" : "Timeline has gaps, invalid ranges or incomplete coverage");
  return { passed: checks.every(c => c.result !== "fail"), checkedAt: new Date().toISOString(), durationSeconds: input.duration, checks };
}

export async function checkVideoQuality(meta: ProjectMetadata, targetSeconds: number): Promise<QualityReport> {
  const file = finalVideoFile(meta.id);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { timeout: 30_000 });
  const probe = JSON.parse(stdout); const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  let decoded = true;
  try { await run(resolveFfmpegBin(), ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }); } catch { decoded = false; }
  const { stderr } = await run(resolveFfmpegBin(), ["-hide_banner", "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
    .catch(() => ({ stderr: "" })); // Missing or damaged audio belongs in the quality report.
  const words = JSON.parse(fs.readFileSync(path.join(adDir(meta.id), "out", "render.props.json"), "utf8")).segments?.[0]?.words || [];
  const beats: Beat[] = JSON.parse(fs.readFileSync(path.join(adDir(meta.id), "beats.json"), "utf8")).beats || [];
  const report = assessVideoQuality({ duration: Number(probe.format.duration), width: video?.width || 0, height: video?.height || 0,
    hasAudio: probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio"), decoded,
    meanDb: Number(stderr.match(/mean_volume:\s*([-\d.]+) dB/)?.[1] ?? NaN), peakDb: Number(stderr.match(/max_volume:\s*([-\d.]+) dB/)?.[1] ?? NaN),
    targetSeconds, portrait: meta.aspectRatio === "9:16", words, beats,
    sourcesExist: beats.filter(b => b.kind === "broll").every(b => !!b.clipPath && fs.existsSync(b.clipPath)), captionBottom: meta.captions?.bottomPercent ?? 30 });
  fs.writeFileSync(path.join(adDir(meta.id), "quality.json"), JSON.stringify(report, null, 2));
  return report;
}
