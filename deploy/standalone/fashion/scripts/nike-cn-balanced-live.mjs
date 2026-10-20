#!/usr/bin/env node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { matchesIntent, photoQuery } from '../photo-search.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.env.FASHION_NIKE_CN_EVIDENCE ||
  resolve(here, '../../../../../../output/nike-cn-balanced/normal-balanced-focused-live.json'));
const dataDir = await mkdtemp(join(tmpdir(), 'fashion-nike-cn-balanced-'));
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
  app.server.listen(0, '127.0.0.1', ready);
});
const base = `http://127.0.0.1:${app.server.address().port}/api`;

async function runScope(sourceScope) {
  const input = { subject: '耐克鞋', days: 0, domains: [], sourceScope, sources: ['official', 'media', 'retail'] };
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
  let targetHitAt = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    task = (await call('/tasks/' + created.task.id)).task;
    const relevant = (task.items || []).filter(item =>
      item.imageSha256 && item.sourceImageMatched && matchesIntent(input.subject, item.title));
    if (relevant.length >= 12) {
      targetHitAt = new Date().toISOString();
      break;
    }
    if (task.status !== 'running' && app.jobs.size === 0) break;
    await new Promise(wait => setTimeout(wait, 1000));
  }
  const relevant = (task?.items || []).filter(item =>
    item.imageSha256 && item.sourceImageMatched && matchesIntent(input.subject, item.title));
  return {
    mode: `fresh guest normal ${sourceScope ? 'balanced' : 'focused'} sourceSearchPlan through application API`,
    input,
    normalizedQuery: photoQuery(input.subject),
    startedAt,
    targetHitAt,
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - Date.parse(startedAt),
    taskId: task?.id || created.task.id,
    taskStatusAtCapture: task?.status || null,
    progress: task?.progress || null,
    leads: new Set(relevant.map(item => item.clueKey || item.canonicalURL || item.url)).size,
    photos: new Set(relevant.map(item => item.imageSha256)).size,
    sources: new Set(relevant.map(item => item.source).filter(Boolean)).size,
    items: relevant.map(item => ({
      title: item.title,
      url: item.url,
      source: item.source,
      image: item.image,
      imageSha256: item.imageSha256,
      sourceImageMatched: item.sourceImageMatched,
    })),
  };
}

const focused = await runScope(0);
const balanced = await runScope(1);
const evidence = {
  focused,
  balanced,
  pass: [focused, balanced].every(run => run.photos >= 12 && run.items.every(item => item.sourceImageMatched)),
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
app.server.close();
process.exit(evidence.pass ? 0 : 1);
