import { config } from '../../packages/pipeline/src/config.js';
let token: string | undefined;
const ids = new Set<string>();
for (let page = 0; page < 2; page++) {
  const url = new URL('https://api.heygen.com/v3/avatars/looks');
  url.searchParams.set('ownership', 'public'); url.searchParams.set('limit', '50');
  if (token) url.searchParams.set('token', token);
  const res = await fetch(url, { headers: { 'X-Api-Key': config.heygenApiKey() }, signal: AbortSignal.timeout(20_000) });
  const body = await res.json();
  const looks = body.data ?? [];
  const old = ids.size;
  if (Array.isArray(looks)) for (const a of looks) ids.add(a.id);
  console.log(JSON.stringify({ status: res.status, keys: Object.keys(body), count: looks.length, fresh: ids.size - old, first: looks[0]?.id, last: looks.at(-1)?.id, hasMore: body.has_more, nextToken: body.next_token, pagination: body.pagination }));
  token = body.next_token;
}
