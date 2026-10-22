import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { adDir, DEFAULT_MUSIC, finalVideoFile, ProjectMetadata, REPO_ROOT } from "@ai-ads/core";
import { AgentStore, MAX_ATTEMPTS, type AgentJob } from "./agent-store.js";
import { PerformanceStore, loadKbForPrompt } from "@ai-ads/performance";
import { planAgentResponse } from "./agent-script.js";
import { loadMetadata, saveMetadata } from "./produce.js";
import { runLocalPreview } from "./local-preview.js";
import { runAvatarPreview } from "./avatar-preview.js";
import { checkVideoQuality } from "./video-quality.js";
import { checkScriptCompliance } from "./compliance.js";
import { config } from "./config.js";

const store = new AgentStore();
const owner = `worker_${process.pid}_${randomUUID()}`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const delay = () => new Promise(resolve => setTimeout(resolve, 1000));
/** The Winning Patterns KB from the performance loop; empty until ads have been synced and torn down. */
function loadWinningPatterns(): string {
  let perf: PerformanceStore | undefined;
  try { perf = new PerformanceStore(); return loadKbForPrompt(perf); }
  catch { return ""; }
  finally { perf?.close(); }
}
function safeError(err: unknown) {
  let message = err instanceof Error ? err.message : String(err);
  for (const [key, value] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET/.test(key) && value && value.length > 8) message = message.replaceAll(value, "[redacted]");
  return message.slice(0, 1800);
}
function checkpoint(job: AgentJob, event: string) {
  if (!store.checkpoint(job, owner, event)) throw new Error("Job canceled or worker lease lost");
}
async function execute(job: AgentJob) {
  if (job.attempts > MAX_ATTEMPTS) { job.status = "needs_review"; job.error = "Repeated interruptions reached the attempt limit. Start a new brief."; checkpoint(job, job.error); return; }
  if (!job.scriptDe) {
    job.stage = "script"; checkpoint(job, "Planning the response and German script with Claude");
    const response = await planAgentResponse(job, store.session(job.sessionId)!, loadWinningPatterns());
    job.reply = response.reply; job.title = response.title; job.visualPlan = response.visualPlan;
    job.rationale = response.rationale || undefined; job.usedPatternIds = response.usedPatternIds.length ? response.usedPatternIds : undefined;
    job.scriptDe = response.scriptDe.trim();
    if (response.action === "video") store.autoTitle(job.sessionId, response.title);
    if (response.action === "chat") { job.scriptDe = undefined; job.status = "done"; job.stage = "complete"; }
    else { job.stage = "voice"; if (!job.autoProduce) job.status = "script_review"; }
    store.db.exec("BEGIN IMMEDIATE");
    try {
      checkpoint(job, response.action === "chat" ? "Agent replied; no voice generation requested" : "German script checkpoint saved");
      store.message(job.sessionId, "assistant", response.reply + (job.scriptDe ? `\n\nGerman script:\n${job.scriptDe}` : ""));
      store.db.exec("COMMIT");
    } catch (err) { store.db.exec("ROLLBACK"); throw err; }
    if (job.status !== "running") return;
  }
  // Blocking claims stop here, before any ElevenLabs or HeyGen spend. The script goes back to the
  // review gate so the wording can be fixed and approved; a plain retry would hit the same rule again.
  const blocked = checkScriptCompliance(job.scriptDe!).filter((f) => f.severity === "block");
  if (blocked.length) {
    job.status = "script_review"; job.stage = "voice"; job.autoProduce = false;
    job.error = `Script needs changes before voice generation: ${blocked.map((f) => `"${f.match}" — ${f.message}`).join(" ")}`;
    checkpoint(job, job.error);
    store.message(job.sessionId, "assistant", `${job.error} Edit the script in the review panel and approve it to continue.`);
    return;
  }
  const catalog = path.join(REPO_ROOT, "data", "broll", "catalog.json");
  if (!fs.existsSync(catalog) || !JSON.parse(fs.readFileSync(catalog, "utf8")).length) throw new Error("B-roll library is empty");
  if (config.elevenLabsLanguage() !== "de") throw new Error("Set ELEVENLABS_LANGUAGE=de for the German video agent");
  let meta = loadMetadata(job.projectId);
  if (!meta) {
    const now = new Date().toISOString();
    meta = ProjectMetadata.parse({ id: job.projectId, title: job.title || "Agent German Video", scriptDe: job.scriptDe,
      introMs: 3000, aspectRatio: "9:16", fullAvatar: false, fastCuts: false, brollCutMs: 1800,
      avatar: job.productionMode === "heygen" ? { heygenAvatarId: job.avatarId!, name: job.avatarName } : { heygenAvatarId: "", name: "Local waveform preview" }, avatarVolume: 1, muteAvatar: false,
      music: { ...DEFAULT_MUSIC, volume: 0.15 }, captions: { presetId: "poppins-bold-italic-pop", fontSize: 68, bottomPercent: 30, background: "none" },
      status: "draft", createdAt: now, updatedAt: now });
    saveMetadata(meta);
  }
  job.hasProject = true;
  // A file left by an interrupted export is not a completed checkpoint.
  if (meta.status !== "done" || !fs.existsSync(finalVideoFile(job.projectId)) || (job.allowVoiceRetry && job.quality && !job.quality.passed)) {
    if (job.allowVoiceRetry) {
      const marker = path.join(adDir(job.projectId), "voice-attempt.json");
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
      job.allowVoiceRetry = false;
    }
    job.stage = "voice"; checkpoint(job, job.productionMode === "heygen" ? "Generating or reusing ElevenLabs German narration for HeyGen v3" : "Generating or reusing ElevenLabs German narration; HeyGen disabled");
    if (job.productionMode === "heygen") {
      await runAvatarPreview(job.projectId, (stage, detail) => {
        job.stage = stage; checkpoint(job, detail ?? (stage === "render" ? "Avatar checkpoint saved; rendering B-roll, captions and music" : "Preparing ElevenLabs German narration"));
      });
    } else await runLocalPreview(job.projectId, undefined, stage => {
      job.stage = stage; checkpoint(job, stage === "render" ? "Narration checkpoint saved; rendering B-roll, captions and music" : "Preparing local narration source");
    });
  }
  job.stage = "quality"; checkpoint(job, "Checking full video decode, sound, format, caption timings and B-roll coverage");
  job.quality = await checkVideoQuality(meta, job.targetSeconds);
  job.status = job.quality.passed ? "done" : "needs_review";
  job.stage = "complete";
  job.error = job.quality.passed ? undefined : "Some quality checks failed. Review the report and video before retrying.";
  store.db.exec("BEGIN IMMEDIATE");
  try {
    checkpoint(job, job.quality.passed ? "Video ready — all technical quality checks passed" : job.error!);
    store.message(job.sessionId, "assistant", job.quality.passed
      ? `Your German video is ready (${job.quality.durationSeconds.toFixed(1)} seconds). Technical checks passed. Open the video to review the voice and editing.`
      : "The video rendered, but some quality checks need your review. Open the report below.");
    store.db.exec("COMMIT");
  } catch (err) { store.db.exec("ROLLBACK"); throw err; }
}

async function main() {
  console.log("Video agent worker started (Claude → ElevenLabs → optional HeyGen v3 → B-roll → quality checks)");
  while (!stopping) {
    // The dashboard pauses queue claims while its manual renderer is active.
    const manualLock = path.join(REPO_ROOT, "data", "agent-queue", "manual-render.lock");
    if (fs.existsSync(manualLock) && Date.now() - fs.statSync(manualLock).mtimeMs < 40_000) { await delay(); continue; }
    const job = store.claim(owner);
    if (!job) { await delay(); continue; }
    const heartbeat = setInterval(() => {
      if (!store.heartbeat(job.id, owner)) process.exit(0); // Stop the process tree on cancel; no subsequent stages.
    }, 2000);
    try { await execute(job); }
    catch (err) {
      const message = safeError(err);
      job.error = message; job.status = /interrupted voice request/i.test(message) ? "needs_review" : "error";
      if (store.checkpoint(job, owner, message)) {
        const failed = loadMetadata(job.projectId);
        if (failed && failed.status !== "done") { failed.status = "error"; failed.error = message; failed.updatedAt = new Date().toISOString(); saveMetadata(failed); }
        store.message(job.sessionId, "assistant", `This job stopped: ${message}`);
      }
    } finally { clearInterval(heartbeat); }
  }
  store.close();
}
main().catch(err => { console.error(safeError(err)); process.exitCode = 1; });
