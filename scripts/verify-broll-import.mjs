import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, 'data', 'broll');
const manifestPath = path.join(root, 'drive-import-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const seen = new Map();
const unique = [];
const assertInside = (file) => {
  if (!path.resolve(file).startsWith(root + path.sep)) throw new Error('Path outside B-roll library');
};
for (const item of manifest) {
  assertInside(item.target);
  if (!fs.existsSync(item.target)) { item.status = 'missing'; continue; }
  const bytes = fs.statSync(item.target).size;
  if (bytes !== item.size) { item.status = 'size-mismatch'; continue; }
  item.sha256 = createHash('sha256').update(fs.readFileSync(item.target)).digest('hex');
  const original = seen.get(item.sha256);
  if (original) {
    item.status = 'duplicate';
    item.duplicateOf = original.id;
    const dest = path.join(root, 'duplicates', item.category, path.basename(item.target));
    assertInside(dest);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(dest) !== path.resolve(item.target)) fs.renameSync(item.target, dest);
    item.originalTarget ??= item.target;
    item.target = dest;
    continue;
  }
  seen.set(item.sha256, item);
  unique.push(item);
}
let index = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (index < unique.length) {
    const item = unique[index++];
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
        'format=duration:stream=codec_type,width,height', '-of', 'json', item.target], { timeout: 30_000 });
      const probe = JSON.parse(stdout);
      const video = probe.streams?.find(stream => stream.codec_type === 'video');
      const duration = Number(probe.format?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) throw new Error('No playable video');
      item.durationMs = Math.round(duration * 1000);
      item.width = video.width;
      item.height = video.height;
      item.status = 'ready';
    } catch {
      item.status = 'invalid';
      const dest = path.join(root, 'rejected', item.category, path.basename(item.target));
      assertInside(dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (path.resolve(dest) !== path.resolve(item.target)) fs.renameSync(item.target, dest);
      item.originalTarget ??= item.target;
      item.target = dest;
    }
  }
}));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ total: manifest.length,
  statuses: manifest.reduce((out, item) => { out[item.status] = (out[item.status] ?? 0) + 1; return out; }, {}),
  categories: manifest.filter(item => item.status === 'ready').reduce((out, item) => {
    out[item.category] = (out[item.category] ?? 0) + 1; return out;
  }, {}),
  shortClips: manifest.filter(item => item.status === 'ready' && item.durationMs < 4000).length,
}));
