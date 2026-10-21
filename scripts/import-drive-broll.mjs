import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Downloads only authenticated file references provided by the Drive connector.
// The temporary batch file is removed after processing; signed URLs are not retained.
const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, 'data', 'broll');
const batchPath = path.resolve(process.argv[2]);
if (!batchPath.startsWith(root + path.sep)) throw new Error('Batch must be inside data/broll');
const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
let next = 0;
const results = [];

await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < batch.length) {
    const item = batch[next++];
    const target = path.resolve(item.target);
    if (!target.startsWith(path.join(root, 'clips') + path.sep)) throw new Error('Invalid clip destination');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target) && fs.statSync(target).size === Number(item.size)) {
      results.push({ id: item.id, status: 'existing', target });
      continue;
    }
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(item.downloadUrl, { signal: AbortSignal.timeout(90_000) });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target + '.partial'));
        const bytes = fs.statSync(target + '.partial').size;
        if (bytes !== Number(item.size)) throw new Error(`Size mismatch: ${bytes}`);
        fs.renameSync(target + '.partial', target);
        results.push({ id: item.id, status: 'downloaded', target });
        error = undefined;
        break;
      } catch (err) {
        error = err.name === 'Error' && /^(HTTP|Size mismatch)/.test(err.message) ? err.message : err.name;
      }
    }
    if (error) results.push({ id: item.id, status: 'failed', error });
  }
}));
fs.unlinkSync(batchPath);
const resultPath = batchPath.replace(/\.json$/, '.result.json');
fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ downloaded: results.filter(r => r.status === 'downloaded').length,
  existing: results.filter(r => r.status === 'existing').length,
  failed: results.filter(r => r.status === 'failed') }));
if (results.some(r => r.status === 'failed')) process.exitCode = 1;
