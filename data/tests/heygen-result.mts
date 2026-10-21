import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../packages/pipeline/src/config.js';
import { getHeyGenBalance } from '../../packages/pipeline/src/heygen.js';
import { REPO_ROOT } from '../../packages/core/src/index.js';
const id = 'agent_540336f45f024f1790dba50d84bd0e86';
const checkpoint = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/agent', id, 'main.mp4.heygen.json'), 'utf8'));
const response = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(checkpoint.videoId)}`, { headers: { 'X-Api-Key': config.heygenApiKey() }, signal: AbortSignal.timeout(20_000) });
const body = await response.json();
const data = body.data ?? {};
const report = { checkedAt: new Date().toISOString(), projectId: id, videoId: checkpoint.videoId, status: data.status, hasVideo: !!data.video_url,
  duration: data.duration, progress: data.progress, error: data.error ?? data.failure_reason, balance: await getHeyGenBalance() };
const quality = path.join(REPO_ROOT, 'data/ads', id, 'quality.json');
if (fs.existsSync(quality)) Object.assign(report, { quality: JSON.parse(fs.readFileSync(quality, 'utf8')) });
fs.writeFileSync(path.join(REPO_ROOT, 'data/tests/heygen-v3-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
