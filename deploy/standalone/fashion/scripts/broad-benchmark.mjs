#!/usr/bin/env node
// Real network acceptance. Requires existing server-side DeepSeek configuration.
// Optional FASHION_BENCHMARK_BASE=https://happyspa.studio/fashion exercises production.
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createFashionRouter } from '../router.mjs';
import { similarImage, imageFingerprint } from '../image-quality.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const round = process.env.FASHION_ROUND || new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(process.env.FASHION_BENCHMARK_OUT || join(here, '../../../../../../output/broad-hundred'));
const dataDir = join(output, round + '-data');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
let server, base = process.env.FASHION_BENCHMARK_BASE;
if (!base) {
  const handle = createFashionRouter({ dataDir, authorizeAdmin: async () => false });
  server = createServer(async (req, res) => { try { await handle(req, res); } catch (e) { res.writeHead(500); res.end(e.message); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/fashion';
}
base = base.replace(/\/$/, '') + '/api';
const session = await fetch(base + '/session');
const cookie = session.headers.get('set-cookie')?.split(';')[0];
if (!session.ok || !cookie) throw Error('Benchmark guest session unavailable');
const json = async (name, value) => writeFile(join(output, round + '-' + name + '.json'), JSON.stringify(value, null, 2), { mode: 0o600 });
const call = async (path, body) => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json(); if (!response.ok) throw Error(response.status + ': ' + result.error); return result;
};
const conditions = JSON.parse(process.env.FASHION_SUBJECTS || '["女款冬季休闲鞋","女款小白鞋","女款乐福鞋","女款芭蕾平底鞋","女款凉鞋","女款短靴"]');
const summaries = [];
try {
  for (const [index, subject] of conditions.entries()) {
    const started = Date.now();
    let { task } = await call('/tasks', { subject, days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] });
    while (task.status === 'running') {
      const p = { index, subject, taskId: task.id, seconds: Math.round((Date.now() - started) / 1000), images: task.items.length, checked: task.progress.checked, stage: task.progress.stage };
      console.log(JSON.stringify(p)); await json('progress', p);
      if (Date.now() - started > 14 * 60 * 1000) throw Error('Application did not finish within acceptance deadline');
      await new Promise(r => setTimeout(r, 5000)); ({ task } = await call('/tasks/' + task.id));
    }
    const manifest = [], signatures = [], composites = [];
    await mkdir(join(dataDir, 'assets'), { recursive: true, mode: 0o700 });
    for (const [n, item] of task.items.entries()) {
      let bytes;
      if (server) bytes = await readFile(join(dataDir, 'assets', item.imageSha256));
      else {
        const response = await fetch(base + '/images/' + item.imageSha256, { headers: { cookie } });
        if (!response.ok) throw Error('Cached image not available: ' + response.status);
        bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(join(dataDir, 'assets', item.imageSha256), bytes, { mode: 0o600 });
      }
      const fingerprint = await imageFingerprint(bytes);
      const duplicate = signatures.some(p => similarImage(p, fingerprint)); signatures.push(fingerprint);
      const metadata = await sharp(bytes).metadata();
      const hashOK = createHash('sha256').update(bytes).digest('hex') === item.imageSha256;
      manifest.push({ title: item.title, source: item.source, sourceURL: item.url, evidenceURL: item.evidenceURL, imageURL: item.image,
        hash: item.imageSha256, hashOK, duplicate, width: metadata.width, height: metadata.height, bytes: bytes.length });
      const image = await sharp(bytes).rotate().flatten({ background: '#fff' }).resize(160, 140, { fit: 'contain', background: '#fff' }).png().toBuffer();
      composites.push({ input: image, left: n % 10 * 170, top: Math.floor(n / 10) * 165 });
      const label = Buffer.from(`<svg width="160" height="22"><text x="3" y="16" font-size="12">${n + 1} ${item.source.split('.')[0]}</text></svg>`);
      composites.push({ input: label, left: n % 10 * 170, top: Math.floor(n / 10) * 165 + 140 });
    }
    if (manifest.length) await sharp({ create: { width: 1700, height: Math.ceil(manifest.length / 10) * 165, channels: 3, background: '#fff' } })
      .composite(composites).png().toFile(join(output, round + '-' + index + '-contact.png'));
    const debug = await fetch(base + '/tasks/' + task.id + '/debug?run=' + task.debugRuns.at(-1).id, { headers: { cookie } });
    if (!debug.ok) throw Error('Search trace export unavailable');
    await writeFile(join(output, round + '-' + index + '-trace.jsonl'), await debug.text(), { mode: 0o600 });
    await json(index + '-task', task); await json(index + '-manifest', manifest);
    const summary = { subject, taskId: task.id, version: task.debugRuns.at(-1).version, seconds: Math.round((Date.now() - started) / 1000),
      status: task.status, images: task.items.length, products: new Set(task.items.map(i => i.clueKey)).size,
      sources: [...new Set(task.items.map(i => i.source))], hashesOK: manifest.every(i => i.hashOK), nearDuplicates: manifest.filter(i => i.duplicate).length,
      automaticPass: task.items.length >= 100 && manifest.every(i => i.hashOK && !i.duplicate && i.width >= 350 && i.height >= 250),
      visualReview: 'pending', message: task.message };
    summaries.push(summary); console.log(JSON.stringify({ completed: summary })); await json('summary', summaries);
  }
} finally { if (server) server.close(); }
process.exit(summaries.length === conditions.length && summaries.every(s => s.automaticPass) ? 0 : 1);
