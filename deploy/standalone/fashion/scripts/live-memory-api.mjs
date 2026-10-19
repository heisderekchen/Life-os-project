#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(process.env.FASHION_ACCEPTANCE_OUT ||
  resolve(here, '../../../../../../output/acceptance-300-clues-500-images'));
const round = Number(process.env.FASHION_LIVE_ROUND || 32);
const prefix = `round${round}-live-nike`;
const output = resolve(outputRoot, `${prefix}-memory.json`);
const taskOutput = resolve(outputRoot, `${prefix}-task-at-deadline.json`);
const samplesOutput = resolve(outputRoot, `${prefix}-memory-samples.jsonl`);
const dataDir = resolve(outputRoot, `${prefix}-data`);
const maxSeconds = Number(process.env.FASHION_LIVE_SECONDS || 225);
const port = Number(process.env.FASHION_LIVE_PORT || 4195);
const heapLimitMiB = getHeapStatistics().heap_size_limit / 1024 / 1024;
const maxOldSpaceFlagMiB = Number(process.execArgv.find(value => value.startsWith('--max-old-space-size='))?.split('=')[1] || 0) || null;
const input = { subject: 'nike', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] };
const store = createSourceStore({
  registryFile: resolve(here, '../data/source-registry.json'),
  settingsFile: resolve(dataDir, 'source-admin.json'),
});
const app = createApp({
  dataDir,
  fetcher: sourceFetch(fetch),
  guestPreview: true,
  persistentSessions: true,
  planSources: async value => sourceSearchPlan(value, (await store.read()).sources),
});
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await writeFile(samplesOutput, '');
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

let peak = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
let lastPersistedSample = 0;
const sample = () => {
  const usage = process.memoryUsage();
  for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], usage[key]);
  if (Date.now() - lastPersistedSample >= 5000) {
    lastPersistedSample = Date.now();
    appendFileSync(samplesOutput, JSON.stringify({
      at: new Date().toISOString(),
      rssMiB: +(usage.rss / 1024 / 1024).toFixed(1),
      heapUsedMiB: +(usage.heapUsed / 1024 / 1024).toFixed(1),
      externalMiB: +(usage.external / 1024 / 1024).toFixed(1),
      arrayBuffersMiB: +(usage.arrayBuffers / 1024 / 1024).toFixed(1),
    }) + '\n');
  }
};
const sampler = setInterval(sample, 1000);
sample();
const started = Date.now();
const created = await call('/tasks', input);
let task;
while (Date.now() - started < maxSeconds * 1000) {
  task = (await call('/tasks/' + created.task.id)).task;
  if (task.status !== 'running' && app.jobs.size === 0) break;
  await new Promise(wait => setTimeout(wait, 1000));
}
task ||= (await call('/tasks/' + created.task.id)).task;
clearInterval(sampler);
sample();
const elapsedSeconds = Math.round((Date.now() - started) / 1000);
const itemSources = new Set((task.items || []).map(item => item.source));
const evidence = {
  round,
  startedAt: new Date(started).toISOString(),
  capturedAt: new Date().toISOString(),
  elapsedSeconds,
  maxSeconds,
  maxOldSpaceFlagMiB,
  heapLimitMiB: +heapLimitMiB.toFixed(1),
  taskId: task.id,
  taskStatusAtCapture: task.status,
  fullTaskComplete: task.status !== 'running' && (task.progress?.pendingSources || 0) === 0,
  memoryMiB: Object.fromEntries(Object.entries(peak).map(([key, value]) => [key, +(value / 1024 / 1024).toFixed(1)])),
  metrics: {
    leads: new Set((task.items || []).map(item => item.clueKey || item.productCode || item.canonicalURL || item.url)).size,
    images: new Set((task.items || []).map(item => item.imageSha256).filter(Boolean)).size,
    sources: itemSources.size,
    queriedSources: task.progress?.queriedSources || 0,
    failedSources: task.progress?.failedSources || 0,
    pendingSources: task.progress?.pendingSources || 0,
  },
  limitation: 'This is a constrained local application-API run of the normal Nike planner stopped at the configured deadline; it does not prove the cause of the production restart.',
  pass: elapsedSeconds >= maxSeconds && peak.heapUsed / 1024 / 1024 < heapLimitMiB,
};
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
await writeFile(taskOutput, JSON.stringify(task));
await writeFile(output, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
app.server.close();
process.exit(evidence.pass ? 0 : 1);
