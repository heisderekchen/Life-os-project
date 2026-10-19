import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { requestJSON } from '../public/request.js';

async function service(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'fashion-deadline-'));
  const app = createApp({ dataDir: dir, guestPreview: true, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port + '/api';
  const session = await fetch(base + '/session');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const call = async (path, data) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    return { code: response.status, ...await response.json() };
  };
  t.after(async () => { await Promise.allSettled([...app.jobs.values()]); await new Promise(r => app.server.close(r)); await rm(dir, { recursive: true, force: true }); });
  return { ...app, dir, call };
}

test('unresponsive upstream ends at deadline, persists a retryable error, and retry completes', async t => {
  let hang = true;
  const { call, jobs, dir } = await service(t, { photoSearch: false, searchTimeoutMs: 80,
    fetcher: async () => hang ? new Promise(() => {}) : new Response('<rss><channel></channel></rss>') });
  const { task } = await call('/tasks', { subject: '乐福鞋', days: 7, sourceScope: 2, sources: ['official', 'media', 'retail'] });
  assert.equal(task.status, 'running');
  assert(task.progress.deadlineAt);
  assert.equal((await call('/tasks/' + task.id + '/retry', {})).code, 409);
  await Promise.all([...jobs.values()]);
  let result = (await call('/tasks/' + task.id)).task;
  assert.equal(result.status, 'error');
  assert.match(result.message, /时限/);
  assert.equal(jobs.size, 0);
  const session = await call('/session');
  assert.equal(JSON.parse(await readFile(join(dir, session.account + '.json'), 'utf8')).tasks[0].status, 'error');
  hang = false;
  await call('/tasks/' + task.id + '/retry', {});
  await Promise.all([...jobs.values()]);
  result = (await call('/tasks/' + task.id)).task;
  assert.equal(result.status, 'review');
  assert.equal(result.progress.stage, 'done');
  assert.match(result.message, /未找到/);
});

test('deadline preserves verified partial photos and late upstream responses cannot overwrite completion', async t => {
  let release;
  const never = new Promise(resolve => { release = resolve; });
  const candidates = Array.from({ length: 5 }, (_, i) => ({ title: 'Loafers ' + i, url: 'https://example.com/product/' + i, image: 'https://cdn.example.com/' + i + '.png', width: 800, height: 600 }));
  const fetcher = async value => {
    const url = String(value);
    if (url.includes('/i.js?')) return Response.json({ results: candidates });
    if (url.includes('duckduckgo.com')) return new Response("vqd='4-123'");
    if (url.includes('/product/0')) return never;
    if (url.includes('/product/')) { const i = Number(url.split('/').at(-1)); return new Response(`<title>Loafers ${i}</title><img src="${candidates[i].image}"><script type="application/ld+json">{"datePublished":"${new Date().toISOString()}"}</script>`, { headers: { 'content-type': 'text/html' } }); }
    const png = Buffer.alloc(100); png[0] = 137; png.write('PNG', 1); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20); png[30] = Number(url.split('/').at(-1).split('.')[0]);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  };
  fetcher.trustedRelayHosts = new Set(['example.com', 'cdn.example.com']);
  const { call, jobs } = await service(t, { fetcher, searchTimeoutMs: 400 });
  const { task } = await call('/tasks', { subject: '乐福鞋', days: 7, sourceScope: 2, sources: [] });
  let progress;
  for (let i = 0; i < 40; i++) { progress = (await call('/tasks/' + task.id)).task; if (progress.progress.checked === 4) break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(progress.status, 'running');
  assert.equal(progress.progress.stage, 'verify');
  assert.equal(progress.progress.checked, 4);
  assert.equal(progress.items.length, 4);
  await Promise.all([...jobs.values()]);
  const finished = (await call('/tasks/' + task.id)).task;
  assert.equal(finished.status, 'review');
  assert.equal(finished.items.length, 4);
  assert.match(finished.message, /已保留 4 条/);
  release(new Response('<title>Loafers late response</title>', { headers: { 'content-type': 'text/html' } }));
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual((await call('/tasks/' + task.id)).task, finished);
});

test('a stalled status response or JSON body times out so polling can reconnect', async () => {
  for (const fetcher of [async () => new Promise(() => {}), async () => ({ json: () => new Promise(() => {}) })])
    await assert.rejects(requestJSON('/tasks', {}, { fetcher, timeoutMs: 15 }), e => e.name === 'TimeoutError');
  const { data } = await requestJSON('/tasks', {}, { fetcher: async () => Response.json({ tasks: [] }) });
  assert.deepEqual(data, { tasks: [] });
});
