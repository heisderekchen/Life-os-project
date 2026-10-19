import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench, processLifeOsRecurringTasks } from '../src/personal-workbench.mjs'
const directory = mkdtempSync(join(tmpdir(), 'lifeos-topics-'))
const file = join(directory, 'test.db')
let db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys=ON')
const migrations = join(dirname(dirname(fileURLToPath(import.meta.url))), 'migrations')
for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(join(migrations, name), 'utf8'))
const auth = { role: 'personal-workbench', scope: 'personal-workbench', username: 'test-owner' }
let env = { DB: createD1Sqlite(db) }
const base = '/api/personal-workbench/lifeos'
async function call(path, method = 'GET', body, principal = auth) {
  const request = new Request(`https://test.local${base}${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  const response = await handlePersonalWorkbench(request, env, new URL(request.url), principal)
  return { status: response.status, body: await response.json() }
}
try {
  assert.equal((await call('/topics', 'GET', undefined, null)).status, 404)
  const project = (await call('/compat/projects', 'POST', { name: '项目 A' })).body
  const other = (await call('/compat/projects', 'POST', { name: '项目 B' })).body
  assert.equal((await call('/topics', 'POST', { projectId: project.id, name: ' ' })).status, 400)
  const topic = (await call('/topics', 'POST', { projectId: project.id, name: '主题 A' })).body
  assert.equal(topic.projectId, project.id)
  assert.equal((await call('/topics', 'POST', { projectId: project.id, name: topic.name })).status, 409)
  const task = (await call('/tasks', 'POST', { title: '任务 A', projectId: project.id, topicId: topic.id, taskType: '需求' })).body
  assert.equal(task.topicId, topic.id); assert.equal(task.taskType, '需求')
  assert.equal((await call('/tasks', 'POST', { title: '错误关联', projectId: other.id, topicId: topic.id })).status, 400)
  assert.equal((await call(`/tasks/${task.id}`, 'PATCH', { projectId: other.id, topicId: topic.id })).status, 400)
  assert.equal((await call(`/tasks/${task.id}`, 'PATCH', { topicId: 'missing-topic' })).status, 404)
  assert.equal((await call(`/tasks/${task.id}`, 'PATCH', { taskType: 'x'.repeat(61) })).status, 400)
  assert.equal((await call(`/tasks/${task.id}`, 'GET')).body.topicId, topic.id)
  const exported = (await call('/data/export')).body
  assert.equal(exported.data.topics[0].projectId, project.id)
  assert.equal((await call('/data/import', 'POST', exported)).status, 200)
  assert.equal((await call(`/tasks/${task.id}`, 'GET')).body.topicId, topic.id)
  const renamed = (await call(`/topics/${topic.id}`, 'PATCH', { name: '新主题' })).body
  assert.equal(renamed.name, '新主题')
  db.close(); db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON'); env = { DB: createD1Sqlite(db) }
  assert.equal((await call('/topics')).body[0].name, '新主题')
  assert.equal((await call(`/tasks/${task.id}`, 'GET')).body.topicId, topic.id)
  const moved = (await call(`/tasks/${task.id}`, 'PATCH', { projectId: other.id })).body
  assert.equal(moved.projectId, other.id); assert.equal(moved.topicId, null); assert.equal(moved.taskType, '需求')
  await call(`/tasks/${task.id}`, 'PATCH', { projectId: project.id, topicId: topic.id, recurrence: 'daily', status: 'done', completedAt: '2026-01-01T00:00:00Z' })
  await processLifeOsRecurringTasks(env, Date.UTC(2026, 0, 3))
  const continued = (await call('/tasks')).body.find(item => item.id !== task.id)
  assert.equal(continued.topicId, topic.id); assert.equal(continued.taskType, '需求')
  assert.equal((await call(`/topics/${topic.id}`, 'DELETE')).status, 200)
  const retained = (await call('/tasks')).body
  assert.equal(retained.length, 2); assert.ok(retained.every(item => item.topicId === null))
  const doomed = (await call('/topics', 'POST', { projectId: project.id, name: '项目删除保留任务' })).body
  await call(`/tasks/${task.id}`, 'PATCH', { topicId: doomed.id })
  await call(`/compat/projects/${project.id}`, 'DELETE')
  const orphan = (await call(`/tasks/${task.id}`, 'GET')).body
  assert.equal(orphan.projectId, null); assert.equal(orphan.topicId, null)
  assert.equal((await call('/topics')).body.length, 0)
  // Exercise the legacy import tool's direct SQL reassociation as well as PATCH.
  const payload = { sourceKey: 'topic-ownership-fixture', confirm: true, tasks: [{ sourceId: 'upstream-1', title: '导入归属验收', sourceProject: '项目 B' }] }
  assert.equal((await call('/tasks/import', 'POST', payload)).status, 201)
  const importedId = db.prepare('SELECT task_id FROM lifeos_task_import_sources WHERE source_key=?').get(payload.sourceKey).task_id
  const importedTopic = (await call('/topics', 'POST', { projectId: other.id, name: '导入主题' })).body
  await call(`/tasks/${importedId}`, 'PATCH', { topicId: importedTopic.id, taskType: '研究' })
  await call('/tasks/import', 'POST', { ...payload, reconcile: true })
  assert.equal((await call(`/tasks/${importedId}`, 'GET')).body.topicId, importedTopic.id, 'same-project reconciliation preserves the topic')
  await call('/tasks/import', 'POST', { ...payload, reconcile: true, tasks: [{ ...payload.tasks[0], sourceProject: '项目 C' }] })
  const reassociated = (await call(`/tasks/${importedId}`, 'GET')).body
  assert.equal(reassociated.topicId, null, 'legacy project reassociation clears an incompatible topic')
  assert.equal(reassociated.taskType, '研究', 'user-owned type remains intact')
  console.log('Topic ownership, persistence after reconnect, cross-project rejection, recurrence metadata, non-destructive deletion, and legacy import reconciliation passed.')
} finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
