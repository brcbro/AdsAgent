import { hasPendingWork, isManualRenderActive, readIngestState, runBrollIngest, type IngestState } from "@ai-ads/pipeline";

/*
 * Always-on B-roll ingest scheduler. It polls the inbox and the category folders every few
 * seconds (fs.watch is unreliable on Windows), and runs the classifier job in this process when
 * there is work. The job never starts, and pauses between clips, while the manual renderer holds
 * data/agent-queue/manual-render.lock or an agent job is running. After an error a clip is retried
 * only after a cooldown, so a missing API key does not loop; "Classify unclassified" resets it.
 */

const POLL_MS = 5_000;
const RETRY_COOLDOWN_MS = 10 * 60_000;
const LOG_LINES = 200;

export function installBrollIngest(opts: { busy: () => boolean }) {
  let running = false;
  let requested = false;
  let closing = false;
  let state: IngestState = readIngestState();
  const log: string[] = [];
  const cooldown = new Map<string, number>();
  const skip = (file: string) => (cooldown.get(file) ?? 0) > Date.now();
  const shouldPause = () => opts.busy() || isManualRenderActive();
  const append = (line: string) => { log.push(`${new Date().toISOString()} ${line}`); if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES); };

  async function runNow(): Promise<void> {
    if (closing) return;
    if (running) { requested = true; return; }
    running = true;
    try {
      state = await runBrollIngest({ shouldPause, skip, onProgress: (s) => { state = { ...s }; }, log: append, shouldStop: () => closing,
        owner: `dashboard_${process.pid}` });
      const until = Date.now() + RETRY_COOLDOWN_MS;
      for (const e of state.errors) cooldown.set(e.file, until);
    } catch (err) {
      append(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
      // A trigger that arrived mid-run only matters if something is still waiting.
      if (requested && !closing) { requested = false; if (hasPendingWork(Date.now(), skip)) void runNow(); }
    }
  }

  const timer = setInterval(() => {
    if (running || closing || shouldPause()) return;
    try { if (hasPendingWork(Date.now(), skip)) void runNow(); } catch (err) { append(`Scan failed: ${err instanceof Error ? err.message : String(err)}`); }
  }, POLL_MS);

  return {
    /** Manual trigger: forgets cooldowns so failed clips are retried right away. */
    trigger: () => { cooldown.clear(); void runNow(); },
    /** A nudge after an upload: the file needs a few seconds to count as stable. */
    poke: (delayMs = 3_500) => { setTimeout(() => { if (!running && !closing) void runNow(); }, delayMs).unref(); },
    state: () => ({ ...state, running, paused: running && shouldPause(), log: log.slice(-40) }),
    running: () => running,
    close: () => { closing = true; clearInterval(timer); },
  };
}

export type BrollIngest = ReturnType<typeof installBrollIngest>;
