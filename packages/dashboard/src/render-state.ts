import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { REPO_ROOT } from "@ai-ads/core";
import { loadMetadata, saveMetadata } from "@ai-ads/pipeline";
import { projectFile } from "./routes/projects.js";

let stoppingRender: Promise<void> | undefined;

export async function stopProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  let onClose!: () => void;
  const closed = new Promise<void>((resolve) => { onClose = resolve; });
  child.once("close", onClose);
  try {
    if (process.platform === "win32") {
      await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
    await closed;
  } catch (err) {
    if (child.exitCode === null && child.signalCode === null) throw err;
    await closed;
  } finally {
    child.off("close", onClose);
  }
}

export function restoreCanceledRender(projectId: string): void {
  const meta = loadMetadata(projectId);
  if (!meta || meta.status === "done") return;
  const finished = projectFile(projectId, "final.mp4");
  meta.status = finished ? "done" : "draft";
  meta.outputFile = finished ?? undefined;
  delete meta.error;
  meta.updatedAt = new Date().toISOString();
  saveMetadata(meta);
}

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

function clearRenderState(): void {
  renderState.rendering = false;
  renderState.activeChild = null;
  renderState.activeProjectId = null;
  renderState.startedAt = null;
  renderState.lastLine = null;
}

/** Last non-empty log line, without the "[projectId]" prefix and HeyGen's carriage-return redraws. */
function lastLogLine(chunk: string): string | null {
  const lines = chunk.split(/[\r\n]+/).map((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 200) : null;
}

export function startProduce(projectId: string, opts?: { skipHeygen?: boolean; shuffleBroll?: boolean }): void {
  const args = [projectId,
    // Avatar videos are voiced by the HeyGen voice chosen with the presenter.
    "--heygen-voice", "--renderer=ffmpeg", "--semantic-broll"];
  if (opts?.skipHeygen) args.push("--skip-heygen");
  if (opts?.shuffleBroll) args.push("--shuffle-broll");

  const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const cli = path.join(REPO_ROOT, "packages", "pipeline", "src", "produce-cli.ts");
  renderState.rendering = true;
  renderState.lastRenderError = null;
  renderState.activeProjectId = projectId;
  renderState.startedAt = new Date().toISOString();
  renderState.lastLine = null;
  const child = spawn(process.execPath, ["--import", tsx, cli, ...args], {
    cwd: REPO_ROOT, detached: process.platform !== "win32", windowsHide: true,
  });
  renderState.activeChild = child;
  const finish = (code: number | null) => {
    if (renderState.activeChild !== child || stoppingRender) return;
    clearRenderState();
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

export async function stopProduce(): Promise<void> {
  if (stoppingRender) return stoppingRender;
  const { activeChild, activeProjectId } = renderState;
  if (!activeChild || !activeProjectId) return;
  stoppingRender = stopProcessTree(activeChild)
    .then(() => restoreCanceledRender(activeProjectId))
    .finally(() => {
      stoppingRender = undefined;
      if (!activeChild.pid || activeChild.exitCode !== null || activeChild.signalCode !== null) clearRenderState();
    });
  return stoppingRender;
}
