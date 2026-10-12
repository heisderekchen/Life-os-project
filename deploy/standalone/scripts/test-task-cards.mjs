// In-memory acceptance for the MVP task-card + Worker-routing slice: migration
// rerun, scope/IDOR denial, account-A CRUD, validation, catalog readiness,
// platform-admin routing policy and the unchanged export/reset/import boundary.
// It needs no sockets, so it also runs in constrained environments; the
// loopback/HTTP variant lives in test-task-cards-http.mjs.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'
import {
  LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID, ensurePlatformBootstrap, resolvePrincipal, syncConfiguredWorkspaces,
  workspacePageState,
} from '../src/platform-auth.mjs'
import { issueAccountSessionToken, issueSessionToken } from '../session.mjs'
import { buildWorkerCatalog, handleTaskCardApi } from '../src/task-cards.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(root, '..', '..')
const OWNER = 'lifeos-owner'
const AUTH_SECRET = 'test-only-auth-secret'
const ENTRY_KEY = 'test-only-entry-key'
const DEEPSEEK_MODEL = 'deepseek-fixture-model'
const STAMP = '2026-10-11T00:00:00.000Z'
const HEALTH = { status: 'ok', persistence: 'fixture', taskTrigger: 'approved_worker', providers: { deepseek: true, openai: false } }
const CARD_PREFIX = '/workbench/api/task-cards'

// ---- Schema: every migration, then an explicit rerun of the new one ----
const migrationDir = join(root, 'migrations')
const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()
const migrationSql = name => readFileSync(join(migrationDir, name), 'utf8')
assert.ok(migrationNames.includes('0094_lifeos_task_cards.sql'))

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec("CREATE TABLE IF NOT EXISTS lifeos_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))")
const markMigration = db.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of migrationNames) {
  db.exec('BEGIN IMMEDIATE')
  try { db.exec(migrationSql(name)); markMigration.run(name); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
db.exec(migrationSql('0094_lifeos_task_cards.sql'))
db.exec(migrationSql('0094_lifeos_task_cards.sql'))
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_schema_migrations').get().n, migrationNames.length)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_schema_migrations WHERE name = ?')
  .get('0094_lifeos_task_cards.sql').n, 1)
const taskTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lifeos_task_%' ORDER BY name")
  .all().map(row => row.name)
assert.ok(taskTables.includes('lifeos_task_cards'))
assert.ok(taskTables.includes('lifeos_task_worker_routing'))

const env = {
  DB: createD1Sqlite(db),
  AUTH_SECRET,
  PERSONAL_WORKBENCH_ENTRY_KEY: ENTRY_KEY,
  PERSONAL_WORKBENCH_OWNER: OWNER,
  ENVIRONMENT: 'production',
  DEEPSEEK_MODEL,
  PLATFORM_WORKSPACES_JSON: JSON.stringify([
    { id: 'ws_ops_meta', slug: 'ops', displayName: '运营工作区', configured: false },
  ]),
}
await ensurePlatformBootstrap(env)
await syncConfiguredWorkspaces(env)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_accounts').get().n, 1)

// ---- Fixtures: account A's Life OS tasks plus a member account B ----
const insertTask = db.prepare('INSERT INTO personal_workbench_lifeos_tasks (id,title,status,priority,position,archived,created_at,updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)')
insertTask.run('task-parent', '任务卡父任务', 'todo', 'medium', STAMP, STAMP)
insertTask.run('task-sub', '任务卡现有子任务', 'todo', 'medium', STAMP, STAMP)
insertTask.run('task-other', '另一个任务', 'todo', 'medium', STAMP, STAMP)
db.prepare('UPDATE personal_workbench_lifeos_tasks SET parent_task_id = ? WHERE id = ?').run('task-parent', 'task-sub')
const insertDependency = db.prepare('INSERT INTO lifeos_task_dependencies (id,task_id,depends_on_id) VALUES (?, ?, ?)')
insertDependency.run('dep-parent', 'task-parent', 'task-other')
insertDependency.run('dep-other', 'task-other', 'task-parent')
db.prepare('INSERT INTO platform_accounts (account_id, username, display_name, role, legacy_owner, enabled, session_version, failed_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, 1, 0, ?, ?)')
  .run('acct_b', 'member-b', '成员 B', 'member', STAMP, STAMP)
db.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
  .run('acct_b', 'ws_ops_meta', STAMP, 'test-fixture')
// Security regression fixture: B is a plain member who is *also* mistakenly
// granted the legacy Life OS workspace. The grant alone must never open the
// private surface; only the stable legacy owner principal may use it.
db.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
  .run('acct_b', LEGACY_WORKSPACE_ID, STAMP, 'test-fixture')

// ---- Principals are always resolved fresh from the signed token ----
const ownerPrincipal = await resolvePrincipal(env, issueAccountSessionToken(AUTH_SECRET, LEGACY_ACCOUNT_ID, 1))
assert.equal(ownerPrincipal.role, 'platform_admin')
assert.equal(ownerPrincipal.accountId, LEGACY_ACCOUNT_ID)
const entryPrincipal = await resolvePrincipal(env, issueSessionToken(AUTH_SECRET, ENTRY_KEY, OWNER))
assert.equal(entryPrincipal.type, 'legacy-entry')
assert.equal(entryPrincipal.accountId, LEGACY_ACCOUNT_ID)
const memberPrincipal = await resolvePrincipal(env, issueAccountSessionToken(AUTH_SECRET, 'acct_b', 1))
assert.equal(memberPrincipal.role, 'member')
assert.equal(memberPrincipal.legacyOwner, false)

// Focused security regression: B holds a real fixture grant for the legacy Life
// OS workspace. That grant is honored by `workspacePageState` (the workspace
// resolves as configured for B), yet the private task-card surface must still
// deny B everywhere because access is bound to the stable legacy owner
// principal, not to the workspace grant alone.
const bLifeOsState = await workspacePageState(env, memberPrincipal, 'lifeos')
assert.equal(bLifeOsState.status, 'configured', 'B fixture grant must be a real, resolvable grant')
assert.equal(bLifeOsState.workspace.workspaceId, LEGACY_WORKSPACE_ID)

const jsonOf = async response => JSON.parse(await response.text())
async function call(principal, method, path, body, agentHealth = HEALTH) {
  const url = new URL(`https://lifeos.test${CARD_PREFIX}${path}`)
  const request = new Request(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await handleTaskCardApi(request, env, url, principal, { basePath: '/workbench', agentHealth })
  // server.mjs turns an unhandled path into 404; mirror that boundary here.
  return response || new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}

try {
  // ---- Anonymous / B / other-workspace denial (no existence disclosure). B is
  // probed while holding its `ws_lifeos_legacy` fixture grant above, so the
  // legacy-owner binding (not a missing grant) is what denies it. ----
  for (const [method, path, body] of [
    ['GET', '/catalog', undefined],
    ['GET', '/routing', undefined],
    ['PUT', '/routing', { type: 'bug', role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL }],
    ['DELETE', '/routing?type=bug&role=planner', undefined],
    ['GET', '/tasks/task-parent', undefined],
    ['PUT', '/tasks/task-parent', { type: 'bug', goal: '匿名写入' }],
    ['DELETE', '/tasks/task-parent', undefined],
  ]) {
    const anonymous = await call(null, method, path, body)
    assert.equal(anonymous.status, 404, `anonymous ${method} ${path}`)
    const member = await call(memberPrincipal, method, path, body)
    assert.equal(member.status, 404, `B ${method} ${path}`)
  }
  // A principal whose grant is revoked (or account disabled) fails closed even
  // with a still-signed token, because authority is re-resolved per request.
  assert.equal((await call(await resolvePrincipal(env, 'forged-token'), 'GET', '/catalog')).status, 404)

  // ---- Worker catalog: configured-and-ready only, Gemini labelled, no secrets ----
  const catalogResponse = await call(ownerPrincipal, 'GET', '/catalog')
  assert.equal(catalogResponse.status, 200)
  const catalogText = await catalogResponse.text()
  const catalog = JSON.parse(catalogText)
  const entryOf = name => catalog.catalog.providers.find(entry => entry.provider === name)
  assert.equal(entryOf('deepseek').ready, true)
  assert.equal(entryOf('deepseek').model, DEEPSEEK_MODEL)
  assert.equal(entryOf('openai').ready, false)
  assert.equal(entryOf('openai').model, 'gpt-4.1-mini')
  assert.equal(entryOf('openai').reason, 'provider_not_ready')
  assert.equal(catalog.catalog.readyCount, 1)
  assert.equal(catalog.catalog.agentServiceReachable, true)
  const gemini = catalog.catalog.unavailable.find(entry => entry.provider === 'gemini')
  assert.equal(gemini.available, false)
  assert.equal(gemini.model, undefined)
  assert.match(gemini.message, /Gemini 不在当前服务端模型目录中/)
  assert.deepEqual(catalog.types.map(entry => entry.id), ['bug', 'optimization', 'new_feature', 'environment', 'test'])
  assert.deepEqual(catalog.types.map(entry => entry.label), ['Bug', '优化', '新需求', '环境', '测试'])
  assert.deepEqual(catalog.roles.map(entry => entry.id), ['planner', 'developer', 'reviewer'])
  assert.deepEqual(catalog.roles.map(entry => entry.label), ['规划', '开发', '复核'])
  assert.deepEqual(catalog.statuses.map(entry => entry.id), ['draft', 'ready', 'done'])
  assert.deepEqual(catalog.routing, [])
  assert.equal(/API_KEY|api_key|secret|bearer|sk-|test-only-auth-secret|test-only-entry-key/i.test(catalogText), false)
  // Without a reachable agent service every provider is unready and labelled.
  const offlineCatalog = buildWorkerCatalog(env, null)
  assert.equal(offlineCatalog.readyCount, 0)
  assert.ok(offlineCatalog.providers.every(entry => entry.reason === 'agent_service_not_configured'))

  // ---- Scope fixtures: a same-task card owned by another account id and by
  // another workspace must never be readable or writable through A's surface ----
  const insertCardRow = db.prepare('INSERT INTO lifeos_task_cards (id, account_id, workspace_id, task_id, card_type, goal, expected_artifacts_json, subtask_ids_json, dependency_ids_json, roles_json, verification_evidence_json, next_step, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insertCardRow.run('card-intruder', 'acct_intruder', LEGACY_WORKSPACE_ID, 'task-parent', 'bug', 'LEAK-INTRUDER', '[]', '[]', '[]', '[]', '[]', '', 'draft', STAMP, STAMP)
  insertCardRow.run('card-other-workspace', LEGACY_ACCOUNT_ID, 'ws_ops_meta', 'task-parent', 'bug', 'LEAK-OTHER-WORKSPACE', '[]', '[]', '[]', '[]', '[]', '', 'draft', STAMP, STAMP)
  db.prepare('INSERT INTO lifeos_task_worker_routing (id, account_id, workspace_id, card_type, role, provider, model, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('routing-other-workspace', LEGACY_ACCOUNT_ID, 'ws_ops_meta', 'bug', 'planner', 'deepseek', DEEPSEEK_MODEL, 'fixture', STAMP, STAMP)

  const cardRoute = taskId => `/tasks/${taskId}`
  const scoped = await call(ownerPrincipal, 'GET', cardRoute('task-parent'))
  assert.equal(scoped.status, 200)
  const scopedBody = await jsonOf(scoped)
  assert.equal(scopedBody.card, null, 'another account/workspace card must not leak')
  assert.equal(scopedBody.task.title, '任务卡父任务')
  assert.deepEqual(scopedBody.routing, [], 'another workspace routing must not leak')

  // ---- A CRUD, scoped by the stable account + workspace + task ids ----
  const cardPayload = {
    type: 'optimization',
    goal: '为任务卡建立持久的元数据与 Worker 路由',
    expectedArtifacts: ['0094 迁移', '/workbench/api/task-cards 接口'],
    subtaskIds: ['task-sub'],
    dependencyIds: ['dep-parent'],
    roles: [
      { role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL, objective: '拆分步骤' },
      { role: 'developer', provider: 'deepseek', model: DEEPSEEK_MODEL },
      { role: 'reviewer', provider: null, model: null },
    ],
    verification: ['迁移可重复执行', 'A 读写通过', 'B 与匿名被拒'],
    nextStep: '补充 UI 回归与后续研究切片',
    status: 'ready',
  }
  const created = await call(ownerPrincipal, 'PUT', cardRoute('task-parent'), cardPayload)
  assert.equal(created.status, 201)
  const createdCard = (await jsonOf(created)).card
  assert.equal(createdCard.taskId, 'task-parent')
  assert.equal(createdCard.type, 'optimization')
  assert.equal(createdCard.status, 'ready')
  assert.deepEqual(createdCard.expectedArtifacts, cardPayload.expectedArtifacts)
  assert.deepEqual(createdCard.subtaskIds, ['task-sub'])
  assert.deepEqual(createdCard.dependencyIds, ['dep-parent'])
  assert.deepEqual(createdCard.verification, cardPayload.verification)
  assert.equal(createdCard.nextStep, cardPayload.nextStep)
  assert.deepEqual(createdCard.roles.map(role => role.role).sort(), ['developer', 'planner', 'reviewer'])
  assert.ok(createdCard.updatedAt)
  // Two rows now share the same task id + workspace: the intruder fixture and
  // account A's own row. Only A's row was created by A's request.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards WHERE task_id = ? AND workspace_id = ?')
    .get('task-parent', LEGACY_WORKSPACE_ID).n, 2)
  assert.equal(db.prepare('SELECT account_id FROM lifeos_task_cards WHERE task_id = ? AND workspace_id = ? AND account_id = ?')
    .get('task-parent', LEGACY_WORKSPACE_ID, LEGACY_ACCOUNT_ID).account_id, LEGACY_ACCOUNT_ID)
  assert.equal((await call(entryPrincipal, 'GET', cardRoute('task-parent'))).status, 200, 'legacy entry-key session keeps Life OS read access')

  const reread = await jsonOf(await call(ownerPrincipal, 'GET', cardRoute('task-parent')))
  assert.equal(reread.card.goal, cardPayload.goal)
  const updated = await call(ownerPrincipal, 'PUT', cardRoute('task-parent'), { ...cardPayload, goal: '更新后的目标', status: 'done' })
  assert.equal(updated.status, 200)
  assert.equal((await jsonOf(updated)).card.goal, '更新后的目标')
  // Another account's and another workspace's rows are untouched.
  assert.equal(db.prepare('SELECT goal FROM lifeos_task_cards WHERE id = ?').get('card-intruder').goal, 'LEAK-INTRUDER')
  assert.equal(db.prepare('SELECT goal FROM lifeos_task_cards WHERE id = ?').get('card-other-workspace').goal, 'LEAK-OTHER-WORKSPACE')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, 3)

  const removed = await jsonOf(await call(ownerPrincipal, 'DELETE', cardRoute('task-parent')))
  assert.equal(removed.deleted, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, 2)
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', cardRoute('task-parent')))).card, null)
  assert.equal((await jsonOf(await call(ownerPrincipal, 'DELETE', cardRoute('task-parent')))).deleted, false)
  assert.equal((await call(ownerPrincipal, 'GET', cardRoute('task-missing'))).status, 404)
  assert.equal((await call(ownerPrincipal, 'PUT', cardRoute('task-missing'), cardPayload)).status, 404)
  assert.equal((await call(ownerPrincipal, 'GET', cardRoute('..%2Ftask-parent'))).status, 404)

  // ---- Validation: type, goal, status, lists, role set, task references and
  // worker ids are rejected before anything is written ----
  const rejectCard = async (body, code, label) => {
    const response = await call(ownerPrincipal, 'PUT', cardRoute('task-parent'), body)
    assert.equal(response.status, 400, `card ${label}`)
    assert.equal((await jsonOf(response)).code, code, `card ${label}`)
  }
  await rejectCard({ ...cardPayload, type: 'other' }, 'INVALID_TASK_CARD_TYPE', 'unknown type')
  await rejectCard({ ...cardPayload, type: '新需求' }, 'INVALID_TASK_CARD_TYPE', 'localized type id')
  await rejectCard({ ...cardPayload, goal: '   ' }, 'INVALID_GOAL', 'empty goal')
  await rejectCard({ ...cardPayload, status: 'archived' }, 'INVALID_STATUS', 'unknown status')
  await rejectCard({ ...cardPayload, expectedArtifacts: 'not-a-list' }, 'INVALID_EXPECTED_ARTIFACTS', 'artifacts not a list')
  await rejectCard({ ...cardPayload, verification: [123] }, 'INVALID_VERIFICATION', 'evidence not text')
  await rejectCard({ ...cardPayload, roles: cardPayload.roles.slice(0, 2) }, 'INVALID_ROLE_ASSIGNMENTS', 'only two roles')
  await rejectCard({
    ...cardPayload, roles: [cardPayload.roles[0], cardPayload.roles[0], cardPayload.roles[2]],
  }, 'INVALID_ROLE_ASSIGNMENTS', 'duplicate role')
  await rejectCard({
    ...cardPayload, roles: [{ role: 'owner', provider: null, model: null }, ...cardPayload.roles.slice(1)],
  }, 'INVALID_ROLE_ASSIGNMENTS', 'unknown role')
  await rejectCard({ ...cardPayload, subtaskIds: ['task-other'] }, 'INVALID_SUBTASK_REFERENCE', 'subtask of another task')
  await rejectCard({ ...cardPayload, subtaskIds: ['task-parent'] }, 'INVALID_SUBTASK_REFERENCE', 'task that is not a subtask')
  await rejectCard({ ...cardPayload, subtaskIds: ['task-missing'] }, 'INVALID_SUBTASK_REFERENCE', 'missing subtask')
  await rejectCard({ ...cardPayload, dependencyIds: ['dep-other'] }, 'INVALID_DEPENDENCY_REFERENCE', 'dependency of another task')
  await rejectCard({ ...cardPayload, dependencyIds: ['dep-missing'] }, 'INVALID_DEPENDENCY_REFERENCE', 'missing dependency')
  await rejectCard({
    ...cardPayload, roles: [cardPayload.roles[0], { role: 'developer', provider: 'openai', model: 'gpt-4.1-mini' }, cardPayload.roles[2]],
  }, 'WORKER_MODEL_NOT_READY', 'provider not ready')
  await rejectCard({
    ...cardPayload, roles: [cardPayload.roles[0], { role: 'developer', provider: 'gemini', model: 'gemini-2.0-flash' }, cardPayload.roles[2]],
  }, 'WORKER_MODEL_NOT_READY', 'invented gemini model')
  await rejectCard({
    ...cardPayload, roles: [cardPayload.roles[0], { role: 'developer', provider: 'deepseek' }, cardPayload.roles[2]],
  }, 'INVALID_WORKER_SELECTION', 'provider without model')
  await rejectCard({
    ...cardPayload, roles: [cardPayload.roles[0], { role: 'developer', provider: 'deepseek', model: 'deepseek-flash' }, cardPayload.roles[2]],
  }, 'WORKER_MODEL_NOT_READY', 'model id absent from the configured catalog')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, 2, 'rejected writes must not persist')

  // ---- Worker routing: platform-admin writes only, catalog ids only ----
  assert.deepEqual((await jsonOf(await call(entryPrincipal, 'GET', '/routing'))).routing, [])
  for (const [method, path, body] of [
    ['PUT', '/routing', { type: 'bug', role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL }],
    ['DELETE', '/routing?type=bug&role=planner', undefined],
  ]) {
    const forbidden = await call(entryPrincipal, method, path, body)
    assert.equal(forbidden.status, 403, `legacy entry-key ${method} routing`)
    assert.equal((await jsonOf(forbidden)).code, 'FORBIDDEN')
  }
  const routingPut = await call(ownerPrincipal, 'PUT', '/routing', { type: 'bug', role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL })
  assert.equal(routingPut.status, 200)
  assert.equal((await jsonOf(routingPut)).routing.ready, true)
  const routingList = await jsonOf(await call(ownerPrincipal, 'GET', '/routing'))
  assert.equal(routingList.routing.length, 1)
  assert.deepEqual(routingList.routing[0], {
    type: 'bug', role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL,
    ready: true, updatedBy: OWNER, updatedAt: routingList.routing[0].updatedAt,
  })
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', '/catalog'))).routing.length, 1)
  const rejectRouting = async (body, code, label) => {
    const response = await call(ownerPrincipal, 'PUT', '/routing', body)
    assert.equal(response.status, 400, `routing ${label}`)
    assert.equal((await jsonOf(response)).code, code, `routing ${label}`)
  }
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'openai', model: 'gpt-4.1-mini' }, 'WORKER_MODEL_NOT_READY', 'provider not ready')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'gemini', model: 'gemini-2.0-flash' }, 'WORKER_MODEL_NOT_READY', 'invented gemini model')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'deepseek', model: 'deepseek-flash' }, 'WORKER_MODEL_NOT_READY', 'model absent from catalog')
  await rejectRouting({ type: 'bug', role: 'owner', provider: 'deepseek', model: DEEPSEEK_MODEL }, 'INVALID_TASK_CARD_ROLE', 'unknown role')
  await rejectRouting({ type: 'other', role: 'planner', provider: 'deepseek', model: DEEPSEEK_MODEL }, 'INVALID_TASK_CARD_TYPE', 'unknown type')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'deepseek' }, 'INVALID_WORKER_SELECTION', 'missing model')
  assert.equal((await call(ownerPrincipal, 'DELETE', '/routing?type=bug&role=owner')).status, 400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing').get().n, 2)
  assert.equal((await jsonOf(await call(ownerPrincipal, 'DELETE', '/routing?type=bug&role=planner'))).deleted, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing WHERE id = ?').get('routing-other-workspace').n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing WHERE account_id = ? AND workspace_id = ?')
    .get(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID).n, 0)

  // A card written after the migration rerun still round-trips and surfaces the
  // routing defaults for its type.
  assert.equal((await call(ownerPrincipal, 'PUT', '/routing', { type: 'optimization', role: 'developer', provider: 'deepseek', model: DEEPSEEK_MODEL })).status, 200)
  assert.equal((await call(ownerPrincipal, 'PUT', cardRoute('task-parent'), cardPayload)).status, 201)
  const finalCard = await jsonOf(await call(ownerPrincipal, 'GET', cardRoute('task-parent')))
  assert.equal(finalCard.card.goal, cardPayload.goal)
  assert.equal(finalCard.routing.length, 1)
  assert.equal(finalCard.routing[0].role, 'developer')
  assert.equal(finalCard.routing[0].ready, true)

  // ---- The 40-collection Life OS export/import/reset contract is unchanged ----
  const workbench = (path, method = 'GET', body) => {
    const url = new URL(`https://lifeos.test${path}`)
    const request = new Request(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return handlePersonalWorkbench(request, env, url, { role: 'personal-workbench', scope: 'personal-workbench', username: OWNER })
  }
  const exported = await jsonOf(await workbench('/api/personal-workbench/lifeos/data/export'))
  assert.equal(exported.version, '1.1.0')
  const exportKeys = Object.keys(exported.data)
  assert.equal(exportKeys.length, 40)
  assert.deepEqual(exportKeys.filter(key => /card|routing|worker/i.test(key)), [])
  assert.equal(exported.data.tasks.length, 3)
  const unknownImport = await workbench('/api/personal-workbench/lifeos/data/import', 'POST', { version: '1.1.0', data: { taskCards: [] } })
  assert.equal(unknownImport.status, 400)
  assert.deepEqual((await jsonOf(unknownImport)).unknown, ['taskCards'])
  const cardsBeforeReset = db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n
  const routingBeforeReset = db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing').get().n
  assert.equal((await workbench('/api/personal-workbench/lifeos/data/reset', 'DELETE')).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_tasks').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, cardsBeforeReset)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing').get().n, routingBeforeReset)

  // ---- View contract. The Next toolchain is not installed in this
  // environment, so this is a source/payload contract: selected task details
  // mount the shared task-card/research extension, and the task-card panel only
  // talks to the standalone API (never to /api/agent or a provider). ----
  const pageSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/tasks-page.tsx'), 'utf8')
  const detailsSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/task-detail-extensions.tsx'), 'utf8')
  const panelSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/task-card-panel.tsx'), 'utf8')
  // Static wiring check for server.mjs (the loopback HTTP suite covers this
  // dynamically where sockets are available).
  const serverSource = readFileSync(join(root, 'server.mjs'), 'utf8')
  assert.match(serverSource, /import \{ handleTaskCardApi, TASK_CARD_API_SUFFIX \} from '\.\/src\/task-cards\.mjs'/)
  assert.match(serverSource, /const taskCardPrefix = BASE_PATH \+ TASK_CARD_API_SUFFIX/)
  assert.ok(serverSource.indexOf('resolvePrincipal(env, cookie(req))')
    < serverSource.indexOf('return handleTaskCardRequest(req, res, requestUrl, principal)'),
    'the principal must be re-resolved before the card route is served')
  // The module env must carry the operator-configured model ids (regression:
  // omitting them made the catalog fall back to a hard-coded default), while
  // provider credentials stay out of the standalone server entirely.
  assert.match(serverSource, /DEEPSEEK_MODEL: process\.env\.DEEPSEEK_MODEL/, 'deepseek model id must be forwarded to the module env')
  assert.match(serverSource, /OPENAI_MODEL: process\.env\.OPENAI_MODEL/, 'openai model id must be forwarded to the module env')
  assert.equal(/DEEPSEEK_API_KEY|OPENAI_API_KEY|apiKey/.test(serverSource), false, 'provider keys must stay out of the standalone server')
  assert.match(pageSource, /TaskDetailExtensions/, 'selected task detail must mount the task extensions')
  assert.match(detailsSource, /TaskCardPanel/, 'task detail extensions must mount the task-card panel')
  assert.match(detailsSource, /ResearchPanel/, 'task detail extensions must mount the research panel')
  assert.match(panelSource, /sm:grid-cols/, 'panel must keep a responsive layout')
  assert.match(panelSource, /任务卡/)
  // The stable task id is shown as the card/task number in the header, reusing
  // the existing taskId prop instead of inventing a new one.
  assert.match(panelSource, /任务编号/)
  assert.match(panelSource, /\{taskId\}/, 'the header must render the existing taskId')
  assert.match(panelSource, /apiPath\(/, 'panel must call the standalone API through the base path')
  assert.match(panelSource, /\/api\/task-cards\//)
  assert.equal(/api\/agent/.test(panelSource), false, 'the card UI must not call the AI service')
  assert.equal(/DEEPSEEK_API_KEY|OPENAI_API_KEY|apiKey/.test(panelSource), false, 'no provider key may reach the browser')

  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('Task-card + Worker-routing checks passed: migration rerun, anonymous/B/other-workspace denial, account-A CRUD, validation, catalog readiness without secrets, Gemini labelling, platform-admin routing policy, unchanged export/reset/import boundary and view contract.')
} finally {
  db.close()
}
