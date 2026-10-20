#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_ADIDAS_WORKER_OUT ||
  resolve(here, '../../../../../../output/adidas-broad'));
const maxSources = Number(process.env.FASHION_ADIDAS_WORKER_MAX_SOURCES || 0);
const deadlineMs = Number(process.env.FASHION_ADIDAS_WORKER_DEADLINE_MS || 0);
const input = { subject: '阿迪达斯', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] };

await mkdir(output, { recursive: true, mode: 0o700 });
const dataDir = await mkdtemp(join(output, 'worker-data-'));
const progressFile = join(output, 'worker-progress.json');
const stagesFile = join(output, 'worker-stages.jsonl');
const finalFile = join(output, 'worker-final.json');
const store = createSourceStore({
  registryFile: resolve(here, '../data/source-registry.json'),
  settingsFile: join(dataDir, 'source-admin.json'),
});

const atomicJSON = async (file, value) => {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
};

const app = createApp({
  dataDir,
  fetcher: sourceFetch(fetch),
  guestPreview: true,
  cookiePath: '/fashion/',
  planSources: async value => {
    let plans = sourceSearchPlan(value, (await store.read()).sources);
    if (maxSources > 0) {
      let remaining = maxSources;
      plans = plans.flatMap(plan => {
        if (plan.openDiscovery || plan.catalogURL) return [plan];
        if (!plan.domains.length || remaining <= 0) return [];
        const domains = plan.domains.slice(0, remaining);
        remaining -= domains.length;
        return [{ ...plan, domains,
          ...(plan.sources ? { sources: plan.sources.filter(source => domains.includes(source.domain)) } : {}) }];
      });
    }
    plans.excludedDomains = sourceSearchPlan(value, (await store.read()).sources).excludedDomains || [];
    return plans;
  },
});
await new Promise((ready, reject) => {
  app.server.once('error', reject);
  app.server.listen(4198, '127.0.0.1', ready);
});

const base = 'http://127.0.0.1:4198/api';
const session = await fetch(base + '/session');
const cookie = session.headers.get('set-cookie').split(';')[0];
const account = (await session.json()).account;
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

const startedAt = Date.now();
const created = await call('/tasks', input);
const taskId = created.task.id;
let lastStage = '';
let task = created.task;
for (;;) {
  task = (await call('/tasks/' + taskId)).task;
  const queueFile = join(dataDir, account + '.json');
  let storedTask = null;
  try { storedTask = JSON.parse(await readFile(queueFile, 'utf8')).tasks.find(value => value.id === taskId); } catch {}
  const records = storedTask?.sourceQueue?.records || [];
  const failures = {};
  for (const record of records) {
    for (const check of record.sourceChecks || []) {
      if (check.status === 'error') failures[check.error || record.error || 'source error'] =
        (failures[check.error || record.error || 'source error'] || 0) + 1;
    }
    if (record.status === 'error' && !(record.sourceChecks || []).some(check => check.status === 'error'))
      failures[record.error || 'source error'] = (failures[record.error || 'source error'] || 0) + 1;
  }
  const hashes = new Set((task.items || []).map(item => item.imageSha256).filter(Boolean));
  const clues = new Set((task.items || []).map(item => item.clueKey).filter(Boolean));
  const progress = {
    taskId,
    input,
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    status: task.status,
    stage: task.progress?.stage || '',
    items: task.items.length,
    images: hashes.size,
    clues: clues.size,
    resultSources: [...new Set(task.items.map(item => item.source).filter(Boolean))],
    counters: {
      plannedSources: task.progress?.plannedSources || 0,
      queriedSources: task.progress?.queriedSources || 0,
      matchedSources: task.progress?.matchedSources || 0,
      directoryMatchedSources: task.progress?.directoryMatchedSources || 0,
      failedSources: task.progress?.failedSources || 0,
      pendingSources: task.progress?.pendingSources || 0,
      accepted: task.progress?.accepted || 0,
    },
    queueRecordStatuses: records.reduce((all, record) => {
      all[record.status] = (all[record.status] || 0) + 1;
      return all;
    }, {}),
    failureReasons: Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
  await atomicJSON(progressFile, progress);
  const stageKey = `${task.status}:${progress.stage}:${progress.counters.queriedSources}`;
  if (stageKey !== lastStage) {
    lastStage = stageKey;
    await writeFile(stagesFile, JSON.stringify(progress) + '\n', { flag: 'a', mode: 0o600 });
    console.log(JSON.stringify(progress));
  }
  if (!app.jobs.size && task.status !== 'running' && task.progress?.stage !== 'source-queue') break;
  if (deadlineMs && Date.now() - startedAt >= deadlineMs) {
    await atomicJSON(progressFile, { ...progress, stoppedAtDeadline: true });
    break;
  }
  await new Promise(resolveWait => setTimeout(resolveWait, 2000));
}

const manifest = [];
for (const item of task.items || []) {
  let bytes = 0, verifiedSha256 = '';
  try {
    const body = await readFile(join(dataDir, 'assets', item.imageSha256));
    bytes = body.length;
    verifiedSha256 = createHash('sha256').update(body).digest('hex');
  } catch {}
  manifest.push({
    title: item.title,
    sourcePage: item.url,
    canonicalURL: item.canonicalURL,
    source: item.source,
    productCode: item.productCode,
    clueKey: item.clueKey,
    imageURL: item.image,
    imageSha256: item.imageSha256,
    verifiedFileSha256: verifiedSha256,
    bytes,
    mime: item.imageMime,
    sourceImageMatched: item.sourceImageMatched,
    publishedAt: item.publishedAt,
  });
}
const final = {
  taskId,
  status: task.status,
  complete: !app.jobs.size && task.status !== 'running' && task.progress?.stage !== 'source-queue',
  elapsedMs: Date.now() - startedAt,
  counts: {
    clues: new Set(manifest.map(item => item.clueKey).filter(Boolean)).size,
    images: new Set(manifest.map(item => item.imageSha256).filter(Boolean)).size,
    verifiedFiles: manifest.filter(item => item.imageSha256 && item.imageSha256 === item.verifiedFileSha256).length,
    products: new Set(manifest.map(item => item.productCode).filter(Boolean)).size,
    sources: new Set(manifest.map(item => item.source).filter(Boolean)).size,
  },
  counters: task.progress,
  items: manifest,
};
await atomicJSON(finalFile, final);
console.log(JSON.stringify({ final: finalFile, status: final.status, complete: final.complete, counts: final.counts }));
app.server.closeAllConnections?.();
await new Promise(close => app.server.close(close));
