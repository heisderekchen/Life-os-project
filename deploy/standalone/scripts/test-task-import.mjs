import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createD1Sqlite } from '../d1-sqlite.mjs';
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs';
import { normalizeDotTaskExport } from '../src/dot-task-export.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(resolve(here, '../migrations/0071_lifeos_projects_pilot.sql'), 'utf8'));
db.exec(readFileSync(resolve(here, '../migrations/0087_lifeos_project_source_ids.sql'), 'utf8'));
db.exec(readFileSync(resolve(here, '../migrations/0097_lifeos_task_import_sources.sql'), 'utf8'));
db.exec(readFileSync(resolve(here, '../migrations/0098_lifeos_task_import_metadata.sql'), 'utf8'));
const DB = createD1Sqlite(db);
const env = { DB };
const owner = { role: 'personal-workbench', scope: 'personal-workbench', username: 'synthetic-owner' };
const taskUrl = 'http://lifeos.local/api/personal-workbench/lifeos/tasks/import';
const items = [
  { sourceId: 'dot-001', title: 'Synthetic plan', description: 'fixture only', dueDate: '2026-10-20', priority: 'high' },
  { sourceId: 'dot-002', title: 'Synthetic follow-up' },
];
const payload = { sourceKey: 'dot-fixture', tasks: items };

async function call(path, { method = 'POST', body = payload, auth = owner } = {}) {
  const request = new Request(`http://lifeos.local${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return handlePersonalWorkbench(request, env, new URL(request.url), auth);
}

// Only a verified private-workbench principal can reach the import surface.
const denied = await call('/api/personal-workbench/lifeos/tasks/import/preview', { auth: { role: 'user' } });
assert.equal(denied.status, 404);

// Preview and a missing confirmation are read-only.
let response = await call('/api/personal-workbench/lifeos/tasks/import/preview');
assert.equal(response.status, 200);
let body = await response.json();
assert.deepEqual(body.summary, { total: 2, willCreate: 2, alreadyImported: 0, previouslyDeleted: 0, needsReview: 0 });
assert.deepEqual(body.items.map(item => item.title), ['Synthetic plan', 'Synthetic follow-up']);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, 0);
response = await call('/api/personal-workbench/lifeos/tasks/import');
assert.equal(response.status, 428);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, 0);

// Confirmed batch creates both records and their stable source links atomically.
response = await call('/api/personal-workbench/lifeos/tasks/import', { body: { ...payload, confirm: true } });
assert.equal(response.status, 201);
body = await response.json();
assert.equal(body.imported, 2);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_import_sources').get().n, 2);
const original = db.prepare("SELECT id,title FROM personal_workbench_lifeos_tasks WHERE title='Synthetic plan'").get();

// A user edit wins over a changed upstream copy; stable source IDs prevent a duplicate.
db.prepare('UPDATE personal_workbench_lifeos_tasks SET title=?,description=?,status=? WHERE id=?')
  .run('User-edited plan', 'Keep my notes', 'in-progress', original.id);
response = await call('/api/personal-workbench/lifeos/tasks/import', {
  body: { ...payload, confirm: true, tasks: [{ ...items[0], title: 'Upstream rename' }] },
});
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.imported, 0);
assert.equal(body.summary.alreadyImported, 1);
assert.deepEqual({ ...db.prepare('SELECT title,description,status FROM personal_workbench_lifeos_tasks WHERE id=?').get(original.id) }, {
  title: 'User-edited plan', description: 'Keep my notes', status: 'in-progress',
});

// Similar existing titles are sent to review rather than duplicated.
db.prepare(`INSERT INTO personal_workbench_lifeos_tasks
  (id,title,status,priority,position,archived,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)`)
  .run('manual-1', 'Quarterly notes', 'todo', 'medium', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', {
  body: { sourceKey: 'dot-fixture', tasks: [{ sourceId: 'dot-003', title: ' quarterly   NOTES ' }] },
});
body = await response.json();
assert.equal(body.summary.needsReview, 1);
assert.equal(body.items[0].action, 'needs_review');
assert.equal(body.items[0].title, 'quarterly   NOTES');

// Deleting an imported task leaves a tombstone so later imports do not recreate it.
db.prepare('DELETE FROM personal_workbench_lifeos_tasks WHERE id=?').run(original.id);
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', {
  body: { sourceKey: 'dot-fixture', tasks: [items[0]] },
});
body = await response.json();
assert.equal(body.summary.previouslyDeleted, 1);

// Invalid whole batches fail before any writes.
const beforeInvalid = db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n;
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', {
  body: { sourceKey: 'dot-fixture', tasks: [{ sourceId: 'dup', title: 'One' }, { sourceId: 'dup', title: 'Two' }] },
});
assert.equal(response.status, 400);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, beforeInvalid);

// A storage failure in the middle of a batch rolls back earlier inserts too.
db.exec(`CREATE TRIGGER reject_synthetic_link BEFORE INSERT ON lifeos_task_import_sources
  WHEN NEW.source_task_id='boom' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
const beforeFailed = db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n;
await assert.rejects(() => call('/api/personal-workbench/lifeos/tasks/import', {
  body: { sourceKey: 'atomic-fixture', confirm: true, tasks: [
    { sourceId: 'good', title: 'Atomic good' }, { sourceId: 'boom', title: 'Atomic fail' },
  ] },
}));
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, beforeFailed);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lifeos_task_import_sources WHERE source_key='atomic-fixture'").get().n, 0);

// The real export format has no stable ID. The importer derives one from
// normalized name/project/type, collapses exact repeats, and refuses ambiguous
// repeats rather than guessing whether they represent one source task.
const dotRow = {
  name: 'Synthetic roadmap item', description: 'Fictional description', project: 'Sample project',
  type: '持续', status: 'todo', latest_result: 'Fictional result', links: ['https://example.test/item'],
  updated_at: '2026-10-15T12:00:00.000Z',
};
const dotExport = { title: 'Synthetic export', as_of: '2026-10-15', usage: { fixture: true }, tasks: [dotRow, { ...dotRow, updated_at: '2026-10-16T12:00:00.000Z' }] };
const normalizedDot = normalizeDotTaskExport(dotExport);
assert.equal(normalizedDot.tasks.length, 1);
assert.equal(normalizedDot.tasks[0].sourceUpdatedAt, '2026-10-16T12:00:00.000Z');
assert.equal(normalizedDot.tasks[0].sourceStatus, 'todo');
assert.equal(normalizedDot.tasks[0].sourceProject, 'Sample project');
assert.equal(normalizedDot.tasks[0].sourceType, '持续');
assert.match(normalizedDot.tasks[0].description, /Sample project/);
assert.match(normalizedDot.tasks[0].description, /Fictional result/);
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', { body: dotExport });
assert.equal(response.status, 200);
body = await response.json();
assert.deepEqual(body.summary, { total: 1, willCreate: 1, alreadyImported: 0, previouslyDeleted: 0, needsReview: 0 });
response = await call('/api/personal-workbench/lifeos/tasks/import', { body: { ...dotExport, confirm: true } });
assert.equal(response.status, 201);
body = await response.json();
assert.equal(body.imported, 1);
assert.equal(db.prepare('SELECT source_updated_at FROM lifeos_task_import_sources WHERE source_key=?').get('dot.tasks').source_updated_at, '2026-10-16T12:00:00.000Z');
const linkedProject = db.prepare(`SELECT p.title FROM personal_workbench_lifeos_tasks t
  JOIN personal_workbench_lifeos_projects p ON p.id=t.project_id WHERE t.title='Synthetic roadmap item'`).get();
assert.equal(linkedProject.title, 'Sample project');
assert.equal(db.prepare("SELECT source_type FROM lifeos_task_import_sources WHERE source_key='dot.tasks'").get().source_type, '持续');
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', {
  body: { ...dotExport, tasks: [{ ...dotRow, status: '进行中', updated_at: '2026-10-20T12:00:00.000Z', description: 'Fictional source update' }] },
});
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.summary.alreadyImported, 1);
assert.equal(body.summary.willCreate, 0);
assert.equal(body.items[0].sourceStatus, 'todo', 'first imported source status remains the provenance record');
response = await call('/api/personal-workbench/lifeos/tasks/import', {
  body: { ...dotExport, confirm: true, reconcile: true },
});
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.imported, 0);
assert.equal(body.reconciled, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks WHERE title='Synthetic roadmap item'").get().n, 1);

// Every current Chinese source status has an explicit local mapping. Keep the
// original label as provenance; historical date-range text remains literal,
// and a closed period does not create or extend a task due date.
const sourceStatuses = [
  ['已取消', 'cancelled'], ['已完成', 'done'], ['待核实', 'todo'], ['待确认范围', 'todo'],
  ['持续进行', 'in-progress'], ['本期已结束', 'done'], ['方案待确认', 'todo'], ['进行中', 'in-progress'],
  ['受阻', 'in-progress'], ['待接通', 'todo'], ['研究中', 'in-progress'], ['部分完成', 'in-progress'],
  ['评估中', 'in-progress'], ['实施中', 'in-progress'], ['待批准', 'todo'],
];
for (const [index, [sourceStatus, expectedStatus]] of sourceStatuses.entries()) {
  const exportItem = {
    ...dotRow,
    name: `Synthetic status fixture ${index}`,
    status: sourceStatus,
    description: sourceStatus === '本期已结束' ? '2026-10-01 至 2026-10-15' : 'Synthetic fixture only',
    updated_at: '2026-10-15T12:00:00.000Z',
  };
  const normalized = normalizeDotTaskExport({ ...dotExport, tasks: [exportItem] });
  assert.equal(normalized.tasks[0].status, expectedStatus, `${sourceStatus} canonical status`);
  assert.equal(normalized.tasks[0].sourceStatus, sourceStatus, `${sourceStatus} source status`);
  assert.match(normalized.tasks[0].description, new RegExp(`Source status: ${sourceStatus}`));
  if (sourceStatus === '本期已结束') assert.match(normalized.tasks[0].description, /2026-10-01 至 2026-10-15/);
}
const closedPeriodExport = {
  ...dotExport,
  tasks: [{ ...dotRow, name: 'Synthetic closed period', status: '本期已结束', description: '2026-10-01 至 2026-10-15' }],
};
response = await call('/api/personal-workbench/lifeos/tasks/import', {
  body: { ...closedPeriodExport, confirm: true },
});
assert.equal(response.status, 201);
const closedPeriodTask = db.prepare("SELECT status,due_date,description FROM personal_workbench_lifeos_tasks WHERE title='Synthetic closed period'").get();
assert.equal(closedPeriodTask.status, 'done');
assert.equal(closedPeriodTask.due_date, null);
assert.match(closedPeriodTask.description, /2026-10-01 至 2026-10-15/);
assert.equal(db.prepare("SELECT source_status FROM lifeos_task_import_sources WHERE source_key='dot.tasks' AND source_task_id=?")
  .get(normalizeDotTaskExport(closedPeriodExport).tasks[0].sourceId).source_status, '本期已结束');

// Same title in separate projects has distinct source identities but is a
// review collision; neither record is created silently.
const sameNameExport = { ...dotExport, tasks: [
  { ...dotRow, project: 'Sample project A' },
  { ...dotRow, project: 'Sample project B' },
] };
response = await call('/api/personal-workbench/lifeos/tasks/import/preview', { body: sameNameExport });
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.summary.total, 2);
assert.equal(body.summary.needsReview, 2);
assert.equal(body.summary.willCreate, 0);
assert.equal(body.items[0].action, 'needs_review');
assert.equal(body.items[1].action, 'needs_review');
assert.throws(() => normalizeDotTaskExport({ ...dotExport, tasks: [dotRow, { ...dotRow, description: 'Conflicting synthetic content' }] }), /Ambiguous duplicate source task identity/);
assert.throws(() => normalizeDotTaskExport({ ...dotExport, tasks: [{ ...dotRow, status: 'invented-status' }] }), /Unsupported status/);

db.close();
console.log('Dot export task-import synthetic tests passed.');
