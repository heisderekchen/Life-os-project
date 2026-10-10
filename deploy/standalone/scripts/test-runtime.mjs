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

const exportResponse = await call('/api/personal-workbench/lifeos/data/export')
assert.equal(exportResponse.status, 200)
const tempDir = mkdtempSync(join(tmpdir(), 'lifeos-runtime-test-'))
try {
  const exportPath = join(tempDir, 'fixture.json')
  const targetPath = join(tempDir, 'target.db')
  writeFileSync(exportPath, JSON.stringify(await exportResponse.json()))
  const target = new DatabaseSync(targetPath)
  target.exec('PRAGMA foreign_keys=ON; CREATE TABLE lifeos_schema_migrations(name TEXT PRIMARY KEY)')
  const targetMark = target.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
  for (const name of readdirSync(join(root, 'migrations')).filter(v => v.endsWith('.sql')).sort()) {
    target.exec('BEGIN IMMEDIATE')
    try { target.exec(readFileSync(join(root, 'migrations', name), 'utf8')); targetMark.run(name); target.exec('COMMIT') }
    catch (error) { target.exec('ROLLBACK'); throw error }
  }
  target.close()
  execFileSync('python3', [join(root, 'scripts/import-current-export.py'), targetPath, exportPath], { stdio: 'pipe' })
  const imported = new DatabaseSync(targetPath)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_projects').get().n, 1)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, 1)
  assert.equal(imported.prepare('SELECT COUNT(*) AS n FROM lifeos_task_recurrence_runs').get().n, 0)
  assert.equal(imported.prepare('PRAGMA foreign_key_check').all().length, 0)
  imported.close()

  const broken = JSON.parse(readFileSync(exportPath, 'utf8'))
  broken.data.unknownStoreTable = []
  writeFileSync(exportPath, JSON.stringify(broken))
  const failed = spawnSync('python3', [join(root, 'scripts/import-current-export.py'), targetPath, exportPath], { encoding: 'utf8' })
  assert.notEqual(failed.status, 0)
  const afterFailure = new DatabaseSync(targetPath)
  assert.equal(afterFailure.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_projects').get().n, 1)
  afterFailure.close()
} finally { rmSync(tempDir, { recursive: true, force: true }) }
console.log('Migrations, private API persistence, export/import, counts, foreign keys, and refusal checks passed.')
db.close()
