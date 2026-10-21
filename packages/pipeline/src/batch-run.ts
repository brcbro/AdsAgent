/**
 * Runs a named batch from batches.ts.
 *
 *   pnpm batch-run --list
 *   pnpm batch-run <name> [--only <project-id>] [--skip-heygen] [--shuffle-broll]
 *
 * VIDEO_SESSION picks the output folder. A batch's own session is used when
 * VIDEO_SESSION is not set.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectMetadata, sessionVideoFile } from "@ai-ads/core";
import { BATCHES, type BatchDef, type BatchJob } from "./batches.js";
import { runFactoryJob } from "./factory.js";
import { produceOptionsFromArgv, runProduce, saveMetadata } from "./produce.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function listBatches(): void {
  console.log("\nAvailable batches:\n");
  for (const [name, def] of Object.entries(BATCHES)) {
    console.log(`  ${name.padEnd(24)} ${def.description}`);
  }
  console.log("\nRun one with: pnpm batch-run <name>\n");
}

function produceInChild(projectId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@ai-ads/pipeline", "run", "produce", projectId, "--shuffle-broll"],
      { cwd: REPO, shell: true, env: { ...process.env, FORCE_COLOR: "0" } },
    );
    let err = "";
    child.stdout?.on("data", (d) => process.stdout.write(`[${projectId}] ${d}`));
    child.stderr?.on("data", (d) => {
      err += String(d);
      process.stderr.write(`[${projectId}] ${d}`);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[${projectId}] exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

/** Applies schema defaults so a batch can omit optional fields. */
function toMetadata(job: BatchJob, createdAt: string): ProjectMetadata {
  return ProjectMetadata.parse({ ...job, status: "draft", createdAt, updatedAt: new Date().toISOString() });
}

function failed(meta: ProjectMetadata, e: unknown): void {
  meta.status = "error";
  meta.error = e instanceof Error ? e.message : String(e);
  meta.updatedAt = new Date().toISOString();
  saveMetadata(meta);
  console.error(`[${meta.id}] FAILED:`, meta.error);
}

async function runSequential(def: BatchDef, jobs: BatchJob[], skipHeygen: boolean, shuffleBroll: boolean): Promise<void> {
  for (const job of jobs) {
    const createdAt = (job as Partial<ProjectMetadata>).createdAt ?? new Date().toISOString();
    const meta = toMetadata(job, createdAt);
    saveMetadata(meta);
    console.log(`\n--- ${meta.id} | ${meta.avatar.name} | captions: ${meta.captions?.presetId} ---`);
    try {
      if (def.factory) {
        await runFactoryJob(meta.id, { skipHeygen, shuffleBroll });
      } else {
        await runProduce(meta, { ...produceOptionsFromArgv(), skipHeygen });
      }
    } catch (e) {
      failed(meta, e);
    }
  }
}

async function runParallel(jobs: BatchJob[]): Promise<void> {
  const now = new Date().toISOString();
  for (const job of jobs) {
    saveMetadata(toMetadata(job, now));
    console.log(`  · ${job.id} | ${job.avatar.name} | music: ${job.music?.title ?? "none"}`);
  }
  console.log(`\nLaunching ${jobs.length} parallel renders…\n`);

  const results = await Promise.allSettled(jobs.map((j) => produceInChild(j.id)));
  console.log("\n=== Results ===");
  results.forEach((r, i) => {
    const id = jobs[i].id;
    if (r.status === "fulfilled") {
      console.log(`  ✓ ${id} → ${path.relative(REPO, sessionVideoFile(id))}`);
    } else {
      console.log(`  ✗ ${id} — ${r.reason}`);
    }
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--list")) {
    listBatches();
    return;
  }

  const name = args.find((a) => !a.startsWith("--"));
  const def = name ? BATCHES[name] : undefined;
  if (!def || !name) {
    console.error(`Unknown batch "${name ?? ""}". Run pnpm batch-run --list.`);
    process.exit(1);
  }

  if (def.session) process.env.VIDEO_SESSION ??= def.session;

  const flags = produceOptionsFromArgv();
  const skipHeygen = def.skipHeygen === true || flags.skipHeygen;
  const shuffleBroll = flags.shuffleBroll;
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

  let jobs = def.jobs();
  if (only) jobs = jobs.filter((j) => j.id === only);
  if (jobs.length === 0) {
    console.error(`No project${only ? ` "${only}"` : ""} in batch ${name}.`);
    process.exit(1);
  }

  console.log(`\n=== ${name}: ${jobs.length} project(s), ${def.mode}${def.factory ? ", factory" : ""} ===`);
  console.log(`    ${def.description}`);
  console.log(`    Output: video/${process.env.VIDEO_SESSION ?? "16th June"}/\n`);

  if (def.mode === "parallel") {
    await runParallel(jobs);
  } else {
    await runSequential(def, jobs, skipHeygen, shuffleBroll);
    console.log("\n=== Done ===");
    for (const job of jobs) console.log(`  ${path.relative(REPO, sessionVideoFile(job.id))}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
