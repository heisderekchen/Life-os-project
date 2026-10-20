import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'
import { issueSessionToken, matchesEntryKey, verifySessionToken } from '../session.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const testNow = Date.UTC(2026, 9, 10, 12)
const authToken = issueSessionToken('test-only-secret', 'test-only-entry-key', 'LifeOS-Owner', testNow)
assert.equal(verifySessionToken(authToken, 'test-only-secret', 'test-only-entry-key', testNow)?.username, 'lifeos-owner')
assert.equal(verifySessionToken(authToken, 'wrong-secret', 'test-only-entry-key', testNow), null)
assert.equal(verifySessionToken(authToken, 'test-only-secret', 'rotated-entry-key', testNow), null)
assert.equal(verifySessionToken(authToken, 'test-only-secret', 'test-only-entry-key', testNow + 9 * 60 * 60 * 1000), null)
assert.equal(matchesEntryKey('test-only-entry-key', 'test-only-entry-key'), true)
assert.equal(matchesEntryKey('wrong', 'test-only-entry-key'), false)
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON; CREATE TABLE lifeos_schema_migrations(name TEXT PRIMARY KEY)')
const mark = db.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of readdirSync(join(root, 'migrations')).filter(v => v.endsWith('.sql')).sort()) {
  db.exec('BEGIN IMMEDIATE')
  try { db.exec(readFileSync(join(root, 'migrations', name), 'utf8')); mark.run(name); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
const env = { DB: createD1Sqlite(db), PERSONAL_WORKBENCH_OWNER: 'lifeos-owner' }
const auth = { role: 'personal-workbench', scope: 'personal-workbench', username: 'lifeos-owner' }
async function call(path, method = 'GET', body) {
  const request = new Request(`https://lifeos.test${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const url = new URL(request.url)
  return handlePersonalWorkbench(request, env, url, auth)
}

const stateResponse = await call('/api/personal-workbench/lifeos/app-state')
assert.equal(stateResponse.status, 200)
const initial = await stateResponse.json()
assert.equal(initial.initialized, false)
const savedResponse = await call('/api/personal-workbench/lifeos/app-state', 'PUT', {
  expectedRevision: null,
  preferences: { setupComplete: true, language: 'zh', dashboardWidgets: ['tasks', 'projects'] },
})
assert.equal(savedResponse.status, 200)
const saved = await savedResponse.json()
assert.equal(saved.setupComplete, true)
assert.deepEqual(saved.preferences.dashboardWidgets, ['tasks', 'projects'])
assert.ok(saved.revision)
assert.equal((await call('/api/personal-workbench/lifeos/app-state', 'PUT', { expectedRevision: null, preferences: { theme: 'dark' } })).status, 409)

const projectResponse = await call('/api/personal-workbench/lifeos/compat/projects', 'POST', { name: 'Runtime fixture', color: '#123456' })
assert.equal(projectResponse.status, 201)
const project = await projectResponse.json()
assert.ok(project.id)
const taskResponse = await call('/api/personal-workbench/lifeos/tasks', 'POST', {
  title: 'Persist across refresh', projectId: project.id, dueDate: '2026-10-11', estimatedMinutes: 45,
})
assert.equal(taskResponse.status, 201)
const task = await taskResponse.json()
assert.equal(task.projectId, project.id)
assert.equal(task.dueDate, '2026-10-11T00:00:00.000Z')
const tasksResponse = await call('/api/personal-workbench/lifeos/tasks')
const tasks = await tasksResponse.json()
assert.equal(tasks.length, 1)
assert.equal(tasks[0].title, 'Persist across refresh')
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)

const uuidProjectIds = ['project-source-uuid-a', 'project-source-uuid-b']
for (const [index, sourceId] of uuidProjectIds.entries()) {
  db.prepare(`INSERT INTO personal_workbench_lifeos_projects (title,source_id,created_at,updated_at)
    VALUES (?,?,?,?)`).run(`UUID project ${index}`, sourceId, '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z')
}
const sourceProjectRows = db.prepare('SELECT id FROM personal_workbench_lifeos_projects ORDER BY id').all()
for (const [index, row] of sourceProjectRows.slice(1).entries()) {
  db.prepare(`INSERT INTO personal_workbench_lifeos_tasks
    (id,title,status,priority,archived,project_id,created_at,updated_at)
    VALUES (?,?, 'todo','medium',0,?,?,?)`).run(`uuid-project-task-${index}`, `UUID linked task ${index}`, row.id,
      '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z')
}
const workbenchProjectId = Number(db.prepare(`INSERT INTO personal_workbench_projects
  (title,status,priority,next_action,resume_context,blocker,created_at,updated_at)
  VALUES ('Private workbench project','active',1,'next','context','',?,?)`).run(
    '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z').lastInsertRowid)
db.prepare(`INSERT INTO personal_workbench_checkpoints(project_id,kind,content,next_action,created_at)
  VALUES (?,'progress','private checkpoint','next checkpoint','2026-10-10T00:00:00.000Z')`).run(workbenchProjectId)
db.prepare(`INSERT INTO personal_workbench_audit_log(action,project_id,detail_json,actor,created_at)
  VALUES ('project.updated',?,'{"source":"fixture"}','lifeos-owner','2026-10-10T00:00:00.000Z')`).run(workbenchProjectId)
db.prepare(`INSERT INTO personal_workbench_lifeos_audit_log(action,entity_id,detail_json,actor,created_at)
  VALUES ('task.updated',?,'{"source":"fixture"}','lifeos-owner','2026-10-10T00:00:00.000Z')`).run(task.id)
db.prepare(`INSERT INTO lifeos_task_recurrence_runs(id,source_task_id,completion_key,generated_task_id,created_at)
  VALUES ('ledger-fixture',?,'2026-10-01T00:00:00.000Z','generated-history-fixture','2026-10-02T00:00:00.000Z')`).run(task.id)

db.prepare(`INSERT INTO lifeos_task_notes(id,task_id,content,images_json,created_at,updated_at) VALUES(?,?,?,?,'2026-10-20T08:00:00Z','2026-10-20T08:00:00Z')`).run('note-export-fixture',task.id,'Task note backup fixture',JSON.stringify([{id:'image-export-fixture',name:'backup.png',mime:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ZkAAAAASUVORK5CYII='}]))
const exportResponse = await call('/api/personal-workbench/lifeos/data/export')
assert.equal(exportResponse.status, 200)
const tempDir = mkdtempSync(join(tmpdir(), 'lifeos-runtime-test-'))
try {
  const exportPath = join(tempDir, 'fixture.json')
  const targetPath = join(tempDir, 'target.db')
  writeFileSync(exportPath, JSON.stringify(await exportResponse.json()))
  const exportData = JSON.parse(readFileSync(exportPath, 'utf8'))
  assert.equal(exportData.version, '1.1.0')
  assert.equal(Object.keys(exportData.data).length, 42)
  assert.equal(exportData.data.taskNotes.length, 1)
  assert.equal(exportData.data.taskNotes[0].taskId, task.id)
  assert.equal(exportData.data.workbenchProjects.length, 1)
  assert.equal(exportData.data.workbenchCheckpoints.length, 1)
  assert.equal(exportData.data.workbenchAuditLog.length, 1)
  assert.equal(exportData.data.lifeosAuditLog.length, 4)
  assert.equal(exportData.data.recurrenceRuns.length, 1)
  assert.equal(Object.hasOwn(exportData.data, 'ownerCredentials'), false)
  // Exercise UUID rows before numeric IDs; this order previously allocated a
  // UUID into the numeric project's slot and made the import fail or collide.
  exportData.data.projects = [exportData.data.projects[1], exportData.data.projects[0], exportData.data.projects[2]]
  writeFileSync(exportPath, JSON.stringify(exportData))
  const target = new DatabaseSync(targetPath)
  target.exec('PRAGMA foreign_keys=ON; CREATE TABLE lifeos_schema_migrations(name TEXT PRIMARY KEY)')
  const targetMark = target.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
  for (const name of readdirSync(join(root, 'migrations')).filter(v => v.endsWith('.sql')).sort()) {
    target.exec('BEGIN IMMEDIATE')
    try { target.exec(readFileSync(join(root, 'migrations', name), 'utf8')); targetMark.run(name); target.exec('COMMIT') }
    catch (error) { target.exec('ROLLBACK'); throw error }
  }
  target.close()
  const importOutput = execFileSync('python3', [join(root, 'scripts/import-current-export.py'), targetPath, exportPath], { encoding: 'utf8' })
  const importSummary = JSON.parse(importOutput)
  assert.equal(importSummary.exportVersion, '1.1.0')
  assert.equal(Object.keys(importSummary.importedRows).length, 42)
  const imported = new DatabaseSync(targetPath)
  const restoredNote = imported.prepare('SELECT * FROM lifeos_task_notes WHERE id=?').get('note-export-fixture')
  assert.equal(restoredNote.content, 'Task note backup fixture')
  assert.equal(JSON.parse(restoredNote.images_json)[0].id, 'image-export-fixture')
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_projects').get().n, 3)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, 3)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM lifeos_task_recurrence_runs').get().n, 1)
  assert.equal(imported.prepare('SELECT completion_key FROM lifeos_task_recurrence_runs WHERE id=?').get('ledger-fixture').completion_key, '2026-10-01T00:00:00.000Z')
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_projects').get().n, 1)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_checkpoints').get().n, 1)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_audit_log').get().n, 1)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_audit_log').get().n, 4)
  assert.equal(imported.prepare('SELECT COUNT(DISTINCT id) AS n FROM personal_workbench_lifeos_projects').get().n, 3)
  assert.equal(imported.prepare(`SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks t
    JOIN personal_workbench_lifeos_projects p ON p.id=t.project_id WHERE t.title LIKE 'UUID linked task %'`).get().n, 2)
  assert.equal(imported.prepare('PRAGMA foreign_key_check').all().length, 0)
  imported.close()

  const broken = JSON.parse(readFileSync(exportPath, 'utf8'))
  broken.data.unknownStoreTable = []
  writeFileSync(exportPath, JSON.stringify(broken))
  const failed = spawnSync('python3', [join(root, 'scripts/import-current-export.py'), targetPath, exportPath], { encoding: 'utf8' })
  assert.notEqual(failed.status, 0)
  const afterFailure = new DatabaseSync(targetPath)
  assert.equal(afterFailure.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_projects').get().n, 3)
  afterFailure.close()
} finally { rmSync(tempDir, { recursive: true, force: true }) }

db.prepare(`INSERT INTO personal_workbench_lifeos_tasks
  (id,title,status,priority,recurrence,due_date,archived,created_at,updated_at)
  VALUES ('repeat-root','Weekly review','done','medium','weekly','2026-10-01',0,'2026-10-01','2026-10-01'),
         ('repeat-next','Weekly review','in-progress','medium','weekly','2026-10-08',0,'2026-10-02','2026-10-03'),
         ('daily-root','Daily check','todo','low','daily','2026-10-10',0,'2026-10-02','2026-10-02')`).run()
db.prepare(`INSERT INTO lifeos_task_recurrence_runs(id,source_task_id,completion_key,generated_task_id,created_at)
  VALUES ('repeat-link','repeat-root','2026-10-01T00:00:00.000Z','repeat-next','2026-10-02T00:00:00.000Z')`).run()
const recurringResponse = await call('/api/personal-workbench/lifeos/recurring-tasks')
assert.equal(recurringResponse.status, 200)
const recurring = await recurringResponse.json()
assert.equal(recurring.series.length, 2, 'generated instances collapse into one recurring series')
assert.equal(recurring.activeCount, 2, 'only the latest active instance contributes once')
assert.equal(recurring.schedulerEnabled, false, 'runtime must report the recurrence gate without implying execution')
assert.equal(recurring.series.find(item => item.id === 'repeat-root')?.currentTaskId, 'repeat-next')
assert.equal(recurring.series.find(item => item.id === 'repeat-root')?.recurrence, 'weekly')

db.prepare(`UPDATE personal_workbench_lifeos_tasks SET recurrence=NULL WHERE id='repeat-next'`).run()
const stoppedRecurrence = await call('/api/personal-workbench/lifeos/recurring-tasks')
const stopped = await stoppedRecurrence.json()
assert.equal(stopped.series.some(item => item.id === 'repeat-root'), false, 'stopping recurrence on the current instance removes the series')
assert.equal(stopped.activeCount, 1, 'the stopped chain no longer contributes to the active count')

db.prepare(`UPDATE personal_workbench_lifeos_tasks SET recurrence=NULL WHERE id='repeat-root'`).run()
db.prepare(`UPDATE personal_workbench_lifeos_tasks SET recurrence='monthly' WHERE id='repeat-next'`).run()
const changedRecurrence = await call('/api/personal-workbench/lifeos/recurring-tasks')
const changed = await changedRecurrence.json()
const changedSeries = changed.series.find(item => item.id === 'repeat-root')
assert.equal(changedSeries?.currentTaskId, 'repeat-next', 'series lineage remains available when the historical root is no longer recurring')
assert.equal(changedSeries?.recurrence, 'monthly', 'the current instance cadence is authoritative')
assert.equal(changed.activeCount, 2, 'the active count follows the current recurring instance')

// Verify additive reminder migration compatibility and persistence across a
// real SQLite file reopen using only local test data.
const persistenceDir = mkdtempSync(join(tmpdir(), 'lifeos-reminder-persistence-'))
try {
  const persistencePath = join(persistenceDir, 'lifeos.sqlite')
  const diskDb = new DatabaseSync(persistencePath)
  diskDb.exec('PRAGMA foreign_keys=ON; CREATE TABLE lifeos_schema_migrations(name TEXT PRIMARY KEY)')
  for (const name of readdirSync(join(root, 'migrations')).filter(v => v.endsWith('.sql') && v !== '0096_lifeos_reminder_fields.sql').sort()) {
    diskDb.exec(readFileSync(join(root, 'migrations', name), 'utf8'))
  }
  diskDb.prepare(`INSERT INTO lifeos_calendar_events
    (id,title,description,start_date,all_day,color,created_at,updated_at)
    VALUES ('legacy-event','Legacy calendar event','keep me','2026-10-12T09:00:00.000Z',0,'#123456',?,?)`)
    .run('2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z')
  diskDb.exec(readFileSync(join(root, 'migrations/0096_lifeos_reminder_fields.sql'), 'utf8'))
  const diskEnv = { DB: createD1Sqlite(diskDb), PERSONAL_WORKBENCH_OWNER: 'lifeos-owner' }
  const diskCall = async (path, method = 'GET', body) => {
    const request = new Request(`https://lifeos.test${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return handlePersonalWorkbench(request, diskEnv, new URL(request.url), auth)
  }
  const legacyResponse = await diskCall('/api/personal-workbench/lifeos/events?limit=10')
  const legacyPayload = await legacyResponse.json()
  assert.equal(legacyPayload.events[0].eventType, 'event', 'pre-migration calendar rows retain their event behavior')
  assert.equal(legacyPayload.events[0].completed, false, 'legacy event defaults to incomplete without losing its fields')
  assert.equal(legacyPayload.events[0].description, 'keep me')

  const created = await diskCall('/api/personal-workbench/lifeos/events', 'POST', {
    title: 'Persisted reminder', eventType: 'reminder', startDate: '2026-10-13T10:00:00.000Z', completed: false,
  })
  assert.equal(created.status, 201)
  const reminder = await created.json()
  assert.equal(reminder.eventType, 'reminder')
  assert.equal((await diskCall(`/api/personal-workbench/lifeos/events/${reminder.id}`, 'PATCH', { completed: true })).status, 200)
  diskDb.close()

  const reopenedDb = new DatabaseSync(persistencePath)
  const reopenedEnv = { DB: createD1Sqlite(reopenedDb), PERSONAL_WORKBENCH_OWNER: 'lifeos-owner' }
  const reopenedCall = async path => {
    const request = new Request(`https://lifeos.test${path}`)
    return handlePersonalWorkbench(request, reopenedEnv, new URL(request.url), auth)
  }
  const reloaded = await reopenedCall('/api/personal-workbench/lifeos/events?limit=10')
  const reloadedPayload = await reloaded.json()
  const savedReminder = reloadedPayload.events.find(item => item.id === reminder.id)
  assert.ok(savedReminder, 'reminder survives closing and reopening the SQLite database')
  assert.equal(savedReminder.eventType, 'reminder')
  assert.equal(savedReminder.completed, true, 'completion state survives a database reopen')
  assert.ok(reloadedPayload.events.some(item => item.id === 'legacy-event' && item.eventType === 'event'))
  reopenedDb.close()
} finally { rmSync(persistenceDir, { recursive: true, force: true }) }

console.log('Migrations, private API persistence, export/import, counts, foreign keys, refusal checks, reminder SQLite reload, and legacy event compatibility passed.')
db.close()
