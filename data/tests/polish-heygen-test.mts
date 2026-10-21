import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { adDir, agentClipPath } from '../../packages/core/src/index.js';
import { AgentStore } from '../../packages/pipeline/src/agent-store.js';
import { loadMetadata, runProduce } from '../../packages/pipeline/src/produce.js';
import { checkVideoQuality } from '../../packages/pipeline/src/video-quality.js';
const id = 'agent_540336f45f024f1790dba50d84bd0e86';
const store = new AgentStore();
try {
  const job = store.jobs().find(j => j.projectId === id);
  if (!job || job.status !== 'done' || job.approvedAt) throw new Error('Only the unapproved completed smoke test may be polished');
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sourceHash = hash(agentClipPath(id)); const audio = path.join(adDir(id), 'main.mp3'); const audioHash = hash(audio);
  const meta = loadMetadata(id)!;
  await runProduce(meta, { skipHeygen: true, elevenLabs: true, renderer: 'ffmpeg', semanticBroll: true, shuffleBroll: false, factory: false });
  if (hash(agentClipPath(id)) !== sourceHash || hash(audio) !== audioHash) throw new Error('A saved source changed unexpectedly');
  job.quality = await checkVideoQuality(meta, job.targetSeconds);
  if (!job.quality.passed) throw new Error('Polished video did not pass quality checks');
  job.updatedAt = new Date().toISOString(); job.events.push({ at: job.updatedAt, text: 'Visual review: merged a one-frame final cut and re-rendered locally with unchanged avatar and narration' });
  store.db.prepare("UPDATE jobs SET doc=? WHERE id=? AND status='done' AND approved_at IS NULL").run(JSON.stringify(job), job.id);
  console.log(JSON.stringify({ duration: job.quality.durationSeconds, checks: job.quality.checks.length, sourceReused: true, audioReused: true }));
} finally { store.close(); }
