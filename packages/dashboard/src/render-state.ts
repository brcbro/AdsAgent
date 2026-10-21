import { spawn } from "node:child_process";
import { REPO_ROOT } from "@ai-ads/core";
import { loadMetadata, saveMetadata } from "@ai-ads/pipeline";

/** State of the single manually started render / preview child process. */
export const renderState = {
  rendering: false,
  lastRenderError: null as string | null,
  activeChild: null as ReturnType<typeof spawn> | null,
  activeProjectId: null as string | null,
  /** When the active child started, and its most recent log line — shown as live progress in the editor. */
  startedAt: null as string | null,
  lastLine: null as string | null,
};

/** Last non-empty log line, without the "[projectId]" prefix and HeyGen's carriage-return redraws. */
function lastLogLine(chunk: string): string | null {
  const lines = chunk.split(/[\r\n]+/).map((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 200) : null;
}

export function startProduce(projectId: string, opts?: { skipHeygen?: boolean; shuffleBroll?: boolean }): void {
  const args = ["--filter", "@ai-ads/pipeline", "run", "produce", projectId,
    "--elevenlabs", "--renderer=ffmpeg", "--semantic-broll"];
  if (opts?.skipHeygen) args.push("--skip-heygen");
  if (opts?.shuffleBroll) args.push("--shuffle-broll");

  startPipeline(projectId, args);
}

export function startPipeline(projectId: string, args: string[]): void {
  renderState.rendering = true;
  renderState.lastRenderError = null;
  renderState.activeProjectId = projectId;
  renderState.startedAt = new Date().toISOString();
  renderState.lastLine = null;
  const child = spawn("pnpm", args, { cwd: REPO_ROOT, shell: true });
  renderState.activeChild = child;
  const finish = (code: number | null) => {
    if (renderState.activeChild !== child) return;
    renderState.rendering = false;
    renderState.activeChild = null;
    renderState.activeProjectId = null;
    renderState.startedAt = null;
    renderState.lastLine = null;
    const meta = loadMetadata(projectId);
    if (meta && code !== 0 && meta.status !== "done") {
      meta.status = "error";
      meta.error = renderState.lastRenderError ?? `Render exited with code ${code}`;
      saveMetadata(meta);
    }
  };
  child.on("close", finish);
  child.on("error", err => { renderState.lastRenderError = err.message; finish(1); });
  child.stdout?.on("data", (d) => {
    const line = lastLogLine(String(d));
    if (line) renderState.lastLine = line;
  });
  child.stderr?.on("data", (d) => {
    const s = String(d);
    if (s.includes("Error") || s.includes("FAILED")) renderState.lastRenderError = s.slice(0, 500);
  });
}
