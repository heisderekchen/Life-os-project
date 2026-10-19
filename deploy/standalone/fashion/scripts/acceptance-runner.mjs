#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSourceStore } from '../admin/store.mjs';
import { sourceFetch } from '../connector.mjs';
import { createApp } from '../server.mjs';
import { sourceSearchPlan } from '../source-planner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(here, '../../../../../../output/acceptance-300-clues-500-images');
const output = resolve(process.env.FASHION_ACCEPTANCE_OUT || defaultOutput);
const port = Number(process.env.SHOE_ACCEPTANCE_PORT || 4199);
const dataDir = resolve(process.env.FASHION_ACCEPTANCE_DATA_DIR || resolve(output, 'server-data'));
const sessionFile = resolve(process.env.FASHION_ACCEPTANCE_SESSION_FILE || '/tmp/fashion-acceptance-session.json');
const requestedRound = Number(process.env.FASHION_ACCEPTANCE_ROUND || 0);
const requestedTaskId = process.env.FASHION_ACCEPTANCE_TASK_ID || '';
const evidencePrefix = process.env.FASHION_ACCEPTANCE_EVIDENCE_PREFIX || (requestedRound ? `round${requestedRound}` : '');
const selectedConditions = new Set(String(process.env.FASHION_ACCEPTANCE_CONDITIONS || 'nike,loafer').split(',').map(x => x.trim()).filter(Boolean));
const catalogOnly = process.env.FASHION_ACCEPTANCE_CATALOG_ONLY === '1';
const catalogProductLimit = Number(process.env.FASHION_ACCEPTANCE_CATALOG_PRODUCT_LIMIT || 0);
const catalogTimeoutMs = Number(process.env.FASHION_ACCEPTANCE_CATALOG_TIMEOUT_MS || 0);
const maxSources = Number(process.env.FASHION_ACCEPTANCE_MAX_SOURCES || 0);
const registryFile = resolve(here, '../data/source-registry.json');
const settingsFile = resolve(dataDir, 'source-admin.json');
const conditions = {
  nike: { subject: 'nike', days: 0, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] },
  loafer: { subject: '乐福鞋', days: 7, domains: [], sourceScope: 2, sources: ['official', 'media', 'retail'] },
};

async function atomicJSON(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

function metrics(task) {
  const items = task.items || [], imageHashes = new Set(items.map(item => item.imageSha256).filter(Boolean));
  const clueKeys = new Set(items.map(item => item.clueKey || item.productCode || item.canonicalURL || item.url).filter(Boolean));
  const sources = new Set(items.map(item => item.source).filter(Boolean));
  const sourcePages = new Set(items.map(item => item.url).filter(Boolean));
  const canonicalPages = new Set(items.map(item => item.canonicalURL || item.url).filter(Boolean));
  const skus = new Set(items.map(item => item.productCode).filter(Boolean));
  const queue = task.sourceQueue || {};
  return {
    items: items.length,
    leads: clueKeys.size,
    images: imageHashes.size,
    distinctSKUs: skus.size,
    distinctCanonicalPages: canonicalPages.size,
    distinctSourcePages: sourcePages.size,
    independentSourcesWithResults: sources.size,
    plannedSources: queue.plannedSources ?? task.progress?.plannedSources ?? 0,
    queriedSources: queue.queriedSources ?? task.progress?.queriedSources ?? 0,
    failedSources: queue.failedSources ?? task.progress?.failedSources ?? 0,
    pendingSources: queue.pendingSources ?? task.progress?.pendingSources ?? 0,
    matchedSources: queue.matchedSources ?? task.progress?.matchedSources ?? 0,
  };
}

async function sourceRevision() {
  const cwd = resolve(here, '../../../..');
  try {
    const trackedDiff = execFileSync('git', ['-C', cwd, 'diff', '--binary'], { encoding: 'utf8' });
    const untracked = execFileSync('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untrackedBodies = [];
    for (const file of untracked.split('\n').filter(Boolean)) {
      try { untrackedBodies.push(file + '\0' + await readFile(resolve(cwd, file))); } catch {}
    }
    return {
      codeHash: execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeHash: createHash('sha256').update(trackedDiff).update(untrackedBodies.join('\n')).digest('hex'),
      changedFiles: execFileSync('git', ['-C', cwd, 'diff', '--name-only'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    };
  } catch {
    return { codeHash: null, changedFiles: [] };
  }
}

function passed(key, task, value) {
  if (key === 'nike') return value.leads >= 300 && value.images >= 500;
  const cutoff = Date.now() - 7 * 86400000;
  return value.leads > 0 && value.images > 0
    && (task.items || []).every(item => item.publishedAt && Date.parse(item.publishedAt) >= cutoff)
    && value.queriedSources === value.plannedSources && value.pendingSources === 0;
}

async function main() {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const store = createSourceStore({ registryFile, settingsFile });
  const fetcher = sourceFetch(fetch);
  const app = createApp({
    dataDir,
    fetcher,
    guestPreview: true,
    persistentSessions: true,
    cookiePath: '/fashion/',
    planSources: async input => {
      let plans = sourceSearchPlan(input, (await store.read()).sources);
      if (catalogOnly) plans = plans.filter(plan => plan.catalogURL);
      if (maxSources > 0) {
        let remaining = maxSources;
        plans = plans.flatMap(plan => {
          if (plan.openDiscovery) return [plan];
          if (!plan.domains.length || remaining <= 0) return [];
          const domains = plan.domains.slice(0, remaining);
          remaining -= domains.length;
          return [{
            ...plan,
            domains,
            ...(plan.sources ? { sources: plan.sources.filter(source => domains.includes(source.domain)) } : {}),
          }];
        });
      }
      if (catalogProductLimit > 0 || catalogTimeoutMs > 0) {
        plans = plans.map(plan => plan.catalogURL ? {
          ...plan,
          ...(catalogProductLimit > 0 ? { catalogProductLimit } : {}),
          ...(catalogTimeoutMs > 0 ? { timeoutMs: catalogTimeoutMs } : {}),
        } : plan);
      }
      plans.excludedDomains = sourceSearchPlan(input, (await store.read()).sources).excludedDomains || [];
      return plans;
    },
  });
  await new Promise((resolveReady, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', resolveReady);
  });
  const base = `http://127.0.0.1:${port}/api`;
  let storedCookie = '';
  try { storedCookie = JSON.parse(await readFile(sessionFile, 'utf8')).cookie || ''; } catch {}
  let session = await fetch(base + '/session', { headers: storedCookie ? { cookie: storedCookie } : {} });
  if (!session.ok) throw Error(`session ${session.status}`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0] || storedCookie;
  if (!cookie) throw Error('acceptance session missing');
  if (!storedCookie) {
    await writeFile(sessionFile, JSON.stringify({ cookie }), { mode: 0o600 });
  }
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
  const progressFile = resolve(output, 'progress.json');
  const roundsFile = resolve(output, 'rounds.jsonl');
  const startedAt = new Date().toISOString();
  const completed = {};

  for (const [key, input] of Object.entries(conditions).filter(([key]) => selectedConditions.has(key))) {
    const started = Date.now();
    const created = requestedTaskId ? await call('/tasks/' + requestedTaskId + '/retry', {}) : await call('/tasks', input);
    const taskId = requestedTaskId || created.task.id;
    await atomicJSON(progressFile, {
      activeCondition: key, taskId, startedAt, updatedAt: new Date().toISOString(),
      phase: 'submitted through real application API', metrics: metrics(created.task),
    });
    let task;
    let stable = 0, previous = '';
    for (;;) {
      task = (await call('/tasks/' + taskId)).task;
      const value = metrics(task);
      await atomicJSON(progressFile, {
        activeCondition: key, taskId, startedAt, updatedAt: new Date().toISOString(),
        phase: task.progress?.stage || task.status, status: task.status,
        metrics: value, target: { leads: 300, images: 500 },
        targetReached: key === 'nike' ? passed(key, task, value) : undefined,
        regressionPass: key === 'loafer' ? passed(key, task, value) : undefined,
        message: task.message || '',
      });
      const fingerprint = JSON.stringify(value) + task.status + (task.progress?.stage || '');
      stable = fingerprint === previous ? stable + 1 : 0;
      previous = fingerprint;
      if (!app.jobs.size && task.status !== 'running' && task.progress?.stage !== 'source-queue') break;
      if (stable >= 2 && (task.status === 'review' || task.status === 'error')
          && (value.pendingSources || 0) === 0) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 2000));
    }
    const prefix = evidencePrefix || `round${requestedRound || 'current'}`;
    await atomicJSON(resolve(output, `${prefix}-task-${key}-final.json`), task);
    const value = metrics(task);
    const manifest = [];
    for (const item of task.items || []) {
      const file = resolve(dataDir, 'assets', item.imageSha256 || '');
      let sha256 = '', bytes = 0;
      try {
        const body = await readFile(file);
        bytes = body.length;
        sha256 = createHash('sha256').update(body).digest('hex');
      } catch {}
      manifest.push({
        itemId: item.id, clueKey: item.clueKey || '', productCode: item.productCode || '',
        sourcePage: item.url, canonicalURL: item.canonicalURL || '', source: item.source,
        imageURL: item.image, imageSha256: item.imageSha256 || '', verifiedFileSha256: sha256,
        bytes, mime: item.imageMime, review: item.review, selected: item.selected,
      });
    }
    await atomicJSON(resolve(output, `${prefix}-image-hashes-${key}.json`), manifest);
    const revision = await sourceRevision();
    const record = {
      round: requestedRound || null, condition: key, at: new Date().toISOString(), input, taskId, status: task.status,
      durationMs: Date.now() - started, ...revision,
      metrics: value, pass: passed(key, task, value),
      passReason: passed(key, task, value)
        ? (key === 'nike' ? 'at least 300 distinct clue keys and 500 distinct original-image hashes'
          : 'all retained items have source dates inside the strict seven-day window; all planned sources attempted')
        : (key === 'nike' ? 'quantity target not reached; retain real gap and source counters'
          : 'seven-day regression failed; inspect dates and source counters'),
      evidence: [`${prefix}-task-${key}-final.json`, `${prefix}-image-hashes-${key}.json`],
    };
    await appendFile(roundsFile, JSON.stringify(record) + '\n');
    completed[key] = record;
    console.log(JSON.stringify({ completed: key, taskId, status: task.status, metrics: value, pass: passed(key, task, value) }));
  }
  const finalReport = {
    startedAt, finishedAt: new Date().toISOString(), output, conditions: completed,
    pass: Object.values(completed).every(record => record.pass),
  };
  await atomicJSON(resolve(output, 'final-report.json'), finalReport);
  await atomicJSON(progressFile, {
    phase: 'finished', updatedAt: new Date().toISOString(), finished: true, round: requestedRound || null,
    pass: finalReport.pass, results: Object.fromEntries(
      Object.entries(completed).map(([key, record]) => [key, record.metrics]),
    ),
  });
  await new Promise(resolveClose => app.server.close(resolveClose));
}

main().catch(error => {
  console.error(JSON.stringify({ error: error.message, output }));
  process.exitCode = 1;
});
