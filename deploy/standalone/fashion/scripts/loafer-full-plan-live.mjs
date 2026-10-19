#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_LOAFER_LIVE_EVIDENCE ||
  resolve(here, '../../../../../../output/acceptance-300-clues-500-images/round28-loafer-full-plan-live.json'));
const dataDir = await mkdtemp(join(tmpdir(), 'fashion-loafer-live-'));
const port = 4197;
const input = { subject: '乐福鞋', days: 7, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] };
const store = createSourceStore({
  registryFile: resolve(here, '../data/source-registry.json'),
  settingsFile: join(dataDir, 'source-admin.json'),
});
const app = createApp({
  dataDir,
  fetcher: sourceFetch(fetch),
  guestPreview: true,
  persistentSessions: true,
  planSources: async value => sourceSearchPlan(value, (await store.read()).sources),
});
await new Promise((ready, reject) => {
  app.server.once('error', reject);
  app.server.listen(port, '127.0.0.1', ready);
});
const base = `http://127.0.0.1:${port}/api`;
const session = await fetch(base + '/session');
const cookie = session.headers.get('set-cookie').split(';')[0];
const call = async (path, body) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const startedAt = new Date().toISOString();
const created = await call('/tasks', input);
let task;
let firstHitAt = null;
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  task = (await call('/tasks/' + created.task.id)).task;
  const recent = (task.items || []).filter(item =>
    item.publishedAt && Date.parse(item.publishedAt) >= Date.now() - 7 * 86400000);
  if (recent.length) {
    firstHitAt = new Date().toISOString();
    break;
  }
  if (task.status !== 'running' && app.jobs.size === 0) break;
  await new Promise(wait => setTimeout(wait, 1500));
}
const recent = (task?.items || []).filter(item =>
  item.publishedAt && Date.parse(item.publishedAt) >= Date.now() - 7 * 86400000);
const evidence = {
  round: 28,
  mode: 'normal sourceSearchPlan through application API',
  startedAt,
  firstHitAt,
  capturedAt: new Date().toISOString(),
  taskId: task?.id || created.task.id,
  taskStatusAtCapture: task?.status || null,
  sourcePlan: {
    categories: input.sources,
    sourceScope: input.sourceScope,
    plannedSources: task?.progress?.plannedSources || 0,
    queriedSourcesAtCapture: task?.progress?.queriedSources || 0,
  },
  fullTaskComplete: false,
  stopReason: 'Stopped the live app process immediately after a verified recent hit; this is a discovery-prefix test, not 1000-source completion.',
  businessRecallPass: recent.length > 0,
  dateSafetyPass: recent.length > 0 && recent.every(item => item.publishedAt && Date.parse(item.publishedAt) >= Date.now() - 7 * 86400000),
  leads: recent.length,
  images: new Set(recent.map(item => item.imageSha256).filter(Boolean)).size,
  items: recent.map(item => ({
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    source: item.source,
    imageSha256: item.imageSha256,
  })),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
app.server.close();
process.exit(evidence.businessRecallPass && evidence.dateSafetyPass ? 0 : 1);
