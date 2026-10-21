import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../../packages/pipeline/src/config.js';
import { listPublicAvatars } from '../../packages/pipeline/src/heygen.js';
import { REPO_ROOT, DEFAULT_MUSIC } from '../../packages/core/src/index.js';

const report: Record<string, unknown> = { checkedAt: new Date().toISOString() };
function safe(value: unknown) {
  let text = value instanceof Error ? value.message : String(value);
  for (const [name, secret] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET/.test(name) && secret && secret.length > 8) text = text.replaceAll(secret, '[redacted]');
  return text.slice(0, 500);
}
async function check(name: string, fn: () => Promise<unknown>) {
  if (detailOnly && name !== 'heygenDefaultAvatar') return;
  if (retryOnly && !['heygenAvatars', 'localAssets'].includes(name)) return;
  try { report[name] = await fn(); } catch (err) { report[name] = { error: safe(err) }; }
}
async function get(url: string, headers: Record<string, string>, timeout = 25_000) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safe(body.error?.message ?? body.detail?.message ?? body.message ?? response.statusText)}`);
  return body;
}
const heygenHeaders = { 'X-Api-Key': config.heygenApiKey() };
const elevenHeaders = { 'xi-api-key': config.elevenLabsApiKey() };
const retryOnly = process.argv.includes('--retry-avatars');
const detailOnly = process.argv.includes('--avatar-detail');
if (retryOnly || detailOnly) Object.assign(report, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/tests/integration-readiness.json'), 'utf8')));
const checks = [
  check('heygenDefaultAvatar', async () => {
    const id = config.heygenAvatarId();
    const { data } = await get(`https://api.heygen.com/v3/avatars/looks/${encodeURIComponent(id)}`, heygenHeaders);
    return { id, name: data?.name, type: data?.avatar_type, status: data?.status, engines: data?.supported_api_engines };
  }),
  check('heygenAccount', async () => {
    const { data } = await get('https://api.heygen.com/v3/users/me', heygenHeaders);
    return { billingType: data?.billing_type, wallet: data?.wallet && { currency: data.wallet.currency, remainingBalance: data.wallet.remaining_balance }, subscription: data?.subscription, usageBased: data?.usage_based };
  }),
  check('heygenAvatars', async () => {
    const avatars = await listPublicAvatars();
    const selected = avatars.find((a: any) => a.avatar_id === process.env.HEYGEN_AVATAR_ID);
    const cachedFile = path.join(REPO_ROOT, 'data/avatars.json');
    const cached = fs.existsSync(cachedFile) ? JSON.parse(fs.readFileSync(cachedFile, 'utf8')) : [];
    const ids = new Set(avatars.map((a: any) => a.avatar_id));
    return { apiVersion: 'v3', available: avatars.length, defaultAvatarConfigured: !!process.env.HEYGEN_AVATAR_ID, defaultAvatarFound: !!selected, defaultAvatarName: selected?.avatar_name, cached: cached.length, cachedStillAvailable: cached.filter((a: any) => ids.has(a.avatar_id)).length };
  }),
  check('elevenSubscription', async () => {
    const body = await get('https://api.elevenlabs.io/v1/user/subscription', elevenHeaders);
    return { tier: body.tier, status: body.status, characterCount: body.character_count, characterLimit: body.character_limit, remainingCharacters: body.character_limit - body.character_count };
  }),
  check('elevenModel', async () => {
    const models = await get('https://api.elevenlabs.io/v1/models', elevenHeaders);
    const model = models.find((m: any) => m.model_id === config.elevenLabsModel());
    return { configuredModel: config.elevenLabsModel(), available: !!model, textToSpeech: model?.can_do_text_to_speech, germanSupported: model?.languages?.some((l: any) => l.language_id === 'de'), availableModels: models.map((m: any) => m.model_id) };
  }),
  check('elevenVoice', async () => {
    const voice = await get(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(config.elevenLabsVoiceId())}`, elevenHeaders);
    return { name: voice.name, category: voice.category, language: config.elevenLabsLanguage(), labels: voice.labels };
  }),
  check('scriptGeneration', async () => {
    if (config.llmProvider() !== 'anthropic') return { provider: config.llmProvider(), note: 'Configured alternative requires its own check' };
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'x-api-key': config.anthropicApiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.anthropicModel(), max_tokens: 32, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: 'Antworte nur mit: Verbindung erfolgreich.' }] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${safe(body.error?.message ?? response.statusText)}`);
    return { provider: 'anthropic', requestedModel: config.anthropicModel(), responseModel: body.model, reply: body.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''), usage: body.usage };
  }),
  check('localAssets', async () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/broll/catalog.json'), 'utf8'));
    const example = catalog[0];
    const pathKey = ['file', 'path', 'filePath', 'clipPath', 'localPath'].find(k => typeof example?.[k] === 'string');
    return { brollClips: catalog.length, pathKey, missingClips: pathKey ? catalog.filter((c: any) => !fs.existsSync(path.isAbsolute(c[pathKey]) ? c[pathKey] : path.join(REPO_ROOT, c[pathKey]))).length : 'unverified', musicConfigured: DEFAULT_MUSIC.file, musicExists: fs.existsSync(path.resolve(REPO_ROOT, DEFAULT_MUSIC.file)), ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true }).split('\n')[0], ffprobe: execFileSync('ffprobe', ['-version'], { encoding: 'utf8', windowsHide: true }).split('\n')[0] };
  }),
];
await Promise.allSettled(checks);
const out = path.join(REPO_ROOT, 'data/tests/integration-readiness.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
