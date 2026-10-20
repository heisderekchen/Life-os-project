#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp, imageDimensions } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_ADIDAS_HERO_OUT ||
  resolve(here, '../../../../../../output/adidas-broad/hero-quality-sample'));
const input = { subject: '阿迪达斯', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] };
await mkdir(output, { recursive: true, mode: 0o700 });
const dataDir = await mkdtemp(join(output, 'data-'));
const store = createSourceStore({
  registryFile: resolve(here, '../data/source-registry.json'),
  settingsFile: join(dataDir, 'source-admin.json'),
});
const app = createApp({
  dataDir,
  fetcher: sourceFetch(fetch),
  guestPreview: true,
  cookiePath: '/fashion/',
  planSources: async value => sourceSearchPlan(value, (await store.read()).sources)
    .filter(plan => plan.catalogue === 'adidas' && plan.catalogURL),
});
await new Promise((ready, reject) => {
  app.server.once('error', reject);
  app.server.listen(0, '127.0.0.1', ready);
});
const base = `http://127.0.0.1:${app.server.address().port}/api`;
const session = await fetch(base + '/session');
const cookie = session.headers.get('set-cookie').split(';')[0];
const call = async (path, body) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${response.status}: ${data.error || 'request failed'}`);
  return data;
};
const created = await call('/tasks', input);
let task;
for (;;) {
  task = (await call('/tasks/' + created.task.id)).task;
  if (!app.jobs.size && task.status !== 'running') break;
  await new Promise(ready => setTimeout(ready, 500));
}
const items = [];
for (const item of task.items || []) {
  const file = join(dataDir, 'assets', item.imageSha256);
  const bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dimensions = imageDimensions(bytes, item.imageMime) || {};
  items.push({
    id: item.productCode,
    title: item.title,
    sourcePage: item.url,
    imageURL: item.image,
    imageSha256: item.imageSha256,
    verifiedFileSha256: sha256,
    bytes: bytes.length,
    mime: item.imageMime,
    width: dimensions.width || 0,
    height: dimensions.height || 0,
    ratio: dimensions.width && dimensions.height ? +(dimensions.width / dimensions.height).toFixed(3) : 0,
    assetFile: `data-${dataDir.split('data-').at(-1)}/assets/${item.imageSha256}`,
  });
}
const evidence = {
  generatedAt: new Date().toISOString(),
  taskId: task.id,
  input,
  plan: 'official Adidas catalog sample through normal guest application API',
  status: task.status,
  counts: {
    images: items.length,
    products: new Set(items.map(item => item.id).filter(Boolean)).size,
    verifiedFiles: items.filter(item => item.imageSha256 === item.verifiedFileSha256).length,
    normalAspect: items.filter(item => item.ratio >= 0.5 && item.ratio <= 2 && item.width >= 350 && item.height >= 250).length,
  },
  items,
};
const resultFile = join(output, 'result.json');
const temporary = resultFile + '.tmp';
await writeFile(temporary, JSON.stringify(evidence, null, 2), { mode: 0o600 });
await rename(temporary, resultFile);
console.log(JSON.stringify({ resultFile, counts: evidence.counts, status: evidence.status }));
app.server.closeAllConnections?.();
await new Promise(close => app.server.close(close));
