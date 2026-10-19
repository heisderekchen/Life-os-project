#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(process.env.FASHION_ACCEPTANCE_OUT ||
  resolve(here, '../../../../../../output/acceptance-300-clues-500-images'));
const dataDir = resolve(process.env.FASHION_QA_DATA_DIR || resolve(outputRoot, 'round26-loafer-normal-data'));
const sessionFile = resolve(process.env.FASHION_QA_SESSION_FILE || '/tmp/fashion-acceptance-round26-session.json');
const taskId = process.env.FASHION_QA_TASK_ID || 'd42dbd2436c2ccdf4347d799';
const proofFile = resolve(outputRoot, 'independent-loafer-proof.json');
const output = resolve(outputRoot, 'round29-loafer-qa-review.json');
const port = 4196;

const { cookie } = JSON.parse(await readFile(sessionFile, 'utf8'));
const proof = JSON.parse(await readFile(proofFile, 'utf8'));
const rejected = proof.find(item => item.visualSampleDecision === 'reject-for-design-material');
if (!rejected) throw Error('independent visual rejection not found');

const app = createApp({ dataDir, guestPreview: true, persistentSessions: true, planSources: async () => [] });
await new Promise((ready, error) => {
  app.server.once('error', error);
  app.server.listen(port, '127.0.0.1', ready);
});
const base = `http://127.0.0.1:${port}/api`;
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

let task = (await call('/tasks/' + taskId)).task;
const item = task.items.find(candidate => candidate.url === rejected.url);
if (!item) throw Error('QA item not found');
const review = await call('/tasks/' + taskId + '/review', {
  id: item.id,
  review: 'excluded',
  selected: false,
  note: '独立人工 QA：全身穿搭构图，鞋部过小，不作为鞋履结构素材。',
});
task = review.task;
const byUrl = new Map(task.items.map(candidate => [candidate.url, candidate]));
const evidence = {
  round: 29,
  reviewedAt: new Date().toISOString(),
  taskId,
  isolatedDataDir: dataDir,
  machineSourcePass: task.items.length > 0,
  machineDistinctSources: new Set(task.items.map(candidate => candidate.source)).size,
  machineItems: task.items.length,
  independentHumanQa: {
    usableShoeReferences: proof.filter(entry => entry.visualSampleDecision === 'usable-shoe-reference').length,
    rejectedItems: proof.filter(entry => entry.visualSampleDecision === 'reject-for-design-material').length,
    excludedItem: {
      title: rejected.title,
      url: rejected.url,
      review: byUrl.get(rejected.url)?.review,
      selected: byUrl.get(rejected.url)?.selected,
      note: byUrl.get(rejected.url)?.note,
    },
  },
  remainingItemsStillPending: task.items.filter(candidate => candidate.review === 'pending').length,
  pass: byUrl.get(rejected.url)?.review === 'excluded'
    && byUrl.get(rejected.url)?.selected === false
    && task.items.filter(candidate => candidate.review === 'pending').length === 3,
};
await writeFile(output, JSON.stringify(evidence, null, 2));
await writeFile(resolve(outputRoot, 'round29-loafer-qa-final-task.json'), JSON.stringify(task, null, 2));
console.log(JSON.stringify(evidence));
await new Promise(close => app.server.close(close));
if (!evidence.pass) process.exitCode = 1;
