// Server-boundary acceptance (HTTP/loopback) for the MVP task-card + routing slice.
// Loopback sockets are required, so it runs in CI (like test-platform-http.mjs).
// It uses SQLite fixtures and a fake AI service only: no real provider keys and
// no provider network calls.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), 'lifeos-task-cards-'))
const dbPath = join(temp, 'lifeos.db')
const nextDir = join(temp, 'next')
mkdirSync(nextDir)
const mockNext = [
  "const http=require('node:http');",
  'http.createServer((req,res)=>{res.writeHead(200,',
  "{'content-type':'text/html'});res.end('mock next '+req.url)})",
  ".listen(Number(process.env.PORT),'127.0.0.1')",
].join('')
writeFileSync(join(nextDir, 'server.js'), mockNext)

// Fake AI service: reports DeepSeek configured/ready and OpenAI not ready. It
// never receives or returns a provider key.
const agent = createHttpServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/v1/health'
    ? { status: 'ok', persistence: 'fixture', taskTrigger: 'approved_worker', providers: { deepseek: true, openai: false } }
    : { ok: true }))
})
await new Promise(resolve => agent.listen(0, '127.0.0.1', resolve))
const agentPort = agent.address().port

const port = await freePort()
const nextPort = await freePort()
const origin = `https://127.0.0.1:${port}`
const ownerName = 'lifeos-owner'
const ownerPassword = 'fixture-owner-password'
const bPassword = 'fixture-b-password-123'
const setupKey = Buffer.alloc(32, 11).toString('base64url')
const setupGrant = `v2.production.${Math.floor(Date.now() / 1000) + 1200}.${setupKey}`
// The catalog must use the operator-configured model id, never a hard-coded one.
const deepseekModel = 'deepseek-fixture-model'
const openaiModel = 'openai-fixture-model'
// Credential-like env values that must never reach the module env or the
// catalog: the server forwards model ids only.
const deepseekKey = 'sk-fixture-deepseek-credential'
const openaiKey = 'sk-fixture-openai-credential'

const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: temp,
  env: {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    AUTH_SECRET: 'test-only-auth-secret',
    PERSONAL_WORKBENCH_ENTRY_KEY: 'test-only-entry-key',
    GATEWAY_PORT: String(port), NEXT_PORT: String(nextPort), NEXT_ROOT: nextDir,
    LIFEOS_LISTEN_HOST: '127.0.0.1',
    ENVIRONMENT: 'production', LIFEOS_PUBLIC_ORIGIN: origin, TRUSTED_PROXY_IP: '127.0.0.1',
    PERSONAL_WORKBENCH_OWNER: ownerName,
    PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED: 'true', PERSONAL_WORKBENCH_OWNER_SETUP_GRANT: setupGrant,
    PLATFORM_WORKSPACES_JSON: JSON.stringify([
      { id: 'ws_ops_meta', slug: 'ops', displayName: '运营工作区', configured: false },
    ]),
    LIFEOS_RECURRENCE_ENABLED: 'false',
    DEEPSEEK_MODEL: deepseekModel,
    OPENAI_MODEL: openaiModel,
    DEEPSEEK_API_KEY: deepseekKey,
    OPENAI_API_KEY: openaiKey,
    AGENT_SERVICE_URL: `http://127.0.0.1:${agentPort}`,
    AGENT_SERVICE_TOKEN: 'test-service-token',
    WORKSPACE_SUBJECT_SIGNING_SECRET: 'test-signing-secret',
  },
  stdio: 'ignore',
})

const base = `http://127.0.0.1:${port}`
const proxyHeaders = { 'x-forwarded-proto': 'https' }
const jsonHeaders = { ...proxyHeaders, origin, 'content-type': 'application/json' }
const CARD_API = '/workbench/api/task-cards'

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`)
    try { if ((await fetch(`${base}/internal/health`)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('server did not become healthy')
}

const cookieOf = response => (response.headers.get('set-cookie') || '').split(';', 1)[0]

function api(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const requestHeaders = method === 'GET' || method === 'HEAD' ? { ...proxyHeaders } : { ...jsonHeaders }
  if (cookie) requestHeaders.cookie = cookie
  Object.assign(requestHeaders, headers)
  return fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const bodyOf = async response => {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return { text } }
}

const cardRoute = taskId => `${CARD_API}/tasks/${taskId}`
const uuid = suffix => `11111111-2222-3333-4444-${String(suffix).padStart(12, '0')}`

let fixtures = null

try {
  await waitReady()

  // Anonymous callers never see the surface at all (no existence disclosure).
  const unknownTaskId = uuid(1)
  const anonymousProbes = [
    ['GET', `${CARD_API}/catalog`, undefined],
    ['GET', `${CARD_API}/routing`, undefined],
    ['PUT', `${CARD_API}/routing`, { type: 'bug', role: 'planner' }],
    ['DELETE', `${CARD_API}/routing?type=bug&role=planner`, undefined],
    ['GET', cardRoute(unknownTaskId), undefined],
    ['PUT', cardRoute(unknownTaskId), { type: 'bug', goal: '匿名写入' }],
    ['DELETE', cardRoute(unknownTaskId), undefined],
  ]
  for (const [method, path, body] of anonymousProbes) {
    const response = await api(path, { method, body })
    assert.equal(response.status, 404, `anonymous ${method} ${path}`)
  }

  // Owner credential bootstrap, legacy entry-key session (account A, not
  // platform admin) and the unified platform-admin login for A.
  assert.equal((await api('/api/personal-workbench/owner-credential', {
    method: 'POST', body: { setupKey, password: ownerPassword, confirmPassword: ownerPassword },
  })).status, 204)
  const entry = await api('/api/personal-workbench/entry', { method: 'POST', body: { key: 'test-only-entry-key' } })
  assert.equal(entry.status, 204)
  const entryCookie = cookieOf(entry)
  const ownerLogin = await api('/api/platform/login', { method: 'POST', body: { username: ownerName, password: ownerPassword } })
  assert.equal(ownerLogin.status, 200)
  const ownerCookie = cookieOf(ownerLogin)
  assert.equal((await ownerLogin.json()).account.role, 'platform_admin')

  // Account B: a plain member whose only grant is a different workspace.
  const createB = await api('/api/platform/admin/accounts', {
    method: 'POST', cookie: ownerCookie, body: { username: 'member-b', displayName: '成员 B' },
  })
  assert.equal(createB.status, 201)
  const bId = (await createB.json()).account.accountId
  assert.equal((await api(`/api/platform/admin/accounts/${bId}/password`, {
    method: 'POST', cookie: ownerCookie, body: { password: bPassword },
  })).status, 204)
  const bLogin = await api('/api/platform/login', { method: 'POST', body: { username: 'member-b', password: bPassword } })
  assert.equal(bLogin.status, 200)
  const bCookie = cookieOf(bLogin)
  assert.equal((await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
    method: 'POST', cookie: ownerCookie, body: { workspaceId: 'ws_ops_meta', granted: true },
  })).status, 200)

  // B / other-workspace denial: invisible even with forged scope hints.
  const bProbes = [
    ['GET', `${CARD_API}/catalog`, undefined],
    ['GET', `${CARD_API}/routing`, undefined],
    ['PUT', `${CARD_API}/routing`, { type: 'bug', role: 'planner', provider: 'deepseek', model: deepseekModel }],
    ['DELETE', `${CARD_API}/routing?type=bug&role=planner`, undefined],
    ['GET', cardRoute(unknownTaskId), undefined],
    ['PUT', cardRoute(unknownTaskId), { type: 'bug', goal: '越权写入' }],
    ['DELETE', cardRoute(unknownTaskId), undefined],
  ]
  for (const [method, path, body] of bProbes) {
    const response = await api(path, {
      method, cookie: bCookie, body,
      headers: { 'x-workspace-subject': ownerName, 'x-platform-role': 'platform_admin' },
    })
    assert.equal(response.status, 404, `B ${method} ${path}`)
  }

  // Fixture Life OS tasks for A: parent task, its existing subtask, another task.
  const createTask = async payload => {
    const response = await api('/workbench/api/tasks', { method: 'POST', cookie: ownerCookie, body: payload })
    assert.equal(response.status, 201, `task create ${payload.title}`)
    return bodyOf(response)
  }
  const parentTask = await createTask({ title: '任务卡父任务' })
  const subtask = await createTask({ title: '任务卡现有子任务', parentTaskId: parentTask.id })
  const otherTask = await createTask({ title: '另一个任务' })

  // Dependency fixtures live in the SQLite file the server opened.
  fixtures = new DatabaseSync(dbPath)
  fixtures.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
  const insertDependency = fixtures.prepare('INSERT INTO lifeos_task_dependencies (id, task_id, depends_on_id) VALUES (?, ?, ?)')
  insertDependency.run('dep-fixture-parent', parentTask.id, otherTask.id)
  insertDependency.run('dep-fixture-other', otherTask.id, parentTask.id)
  const dependencyId = 'dep-fixture-parent'

  // ---- Worker catalog: server-side, configured-and-ready only, no secrets ----
  const catalogResponse = await api(`${CARD_API}/catalog`, { cookie: ownerCookie })
  assert.equal(catalogResponse.status, 200)
  const catalogText = await catalogResponse.text()
  const catalog = JSON.parse(catalogText)
  const providerEntry = name => catalog.catalog.providers.find(entry => entry.provider === name)
  assert.equal(providerEntry('deepseek').ready, true)
  assert.equal(providerEntry('deepseek').model, deepseekModel)
  assert.equal(providerEntry('openai').ready, false)
  // Both operator-configured model ids must reach the catalog (regression: the
  // standalone server previously dropped DEEPSEEK_MODEL/OPENAI_MODEL from env,
  // so the catalog silently fell back to a hard-coded default).
  assert.equal(providerEntry('openai').model, openaiModel)
  assert.equal(providerEntry('openai').reason, 'provider_not_ready')
  assert.equal(catalog.catalog.readyCount, 1)
  const gemini = catalog.catalog.unavailable.find(entry => entry.provider === 'gemini')
  assert.equal(gemini.available, false)
  assert.equal(gemini.model, undefined)
  assert.match(gemini.message, /Gemini 不在当前服务端模型目录中/)
  assert.deepEqual(catalog.types.map(entry => entry.id), ['bug', 'optimization', 'new_feature', 'environment', 'test'])
  assert.deepEqual(catalog.roles.map(entry => entry.id), ['planner', 'developer', 'reviewer'])
  assert.deepEqual(catalog.statuses.map(entry => entry.id), ['draft', 'ready', 'done'])
  assert.deepEqual(catalog.types.map(entry => entry.label), ['Bug', '优化', '新需求', '环境', '测试'])
  assert.deepEqual(catalog.roles.map(entry => entry.label), ['规划', '开发', '复核'])
  assert.deepEqual(catalog.routing, [])
  // No provider credential, token or secret ever leaves the server.
  assert.equal(/API_KEY|api_key|secret|token|sk-|fixture-owner-password|test-only-/i.test(catalogText), false)
  // The configured model ids reached the catalog, but the credential-like env
  // values set on the server process must never appear in the payload.
  assert.equal(catalogText.includes(deepseekKey), false)
  assert.equal(catalogText.includes(openaiKey), false)
  assert.match(catalogText, new RegExp(deepseekModel))
  assert.match(catalogText, new RegExp(openaiModel))

  // ---- Scope fixtures: a same-task card owned by another account id and by
  // another workspace must never be readable or writable through A's surface.
  const insertCardRow = fixtures.prepare('INSERT INTO lifeos_task_cards (id, account_id, workspace_id, task_id, card_type, goal, expected_artifacts_json, subtask_ids_json, dependency_ids_json, roles_json, verification_evidence_json, next_step, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const stamp = '2026-10-11T00:00:00.000Z'
  insertCardRow.run('card-intruder', 'acct_intruder', 'ws_lifeos_legacy', parentTask.id, 'bug', 'LEAK-INTRUDER', '[]', '[]', '[]', '[]', '[]', '', 'draft', stamp, stamp)
  insertCardRow.run('card-other-workspace', 'acct_legacy_owner', 'ws_ops_meta', parentTask.id, 'bug', 'LEAK-OTHER-WORKSPACE', '[]', '[]', '[]', '[]', '[]', '', 'draft', stamp, stamp)
  fixtures.prepare('INSERT INTO lifeos_task_worker_routing (id, account_id, workspace_id, card_type, role, provider, model, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('routing-other-workspace', 'acct_legacy_owner', 'ws_ops_meta', 'bug', 'planner', 'deepseek', deepseekModel, 'intruder', stamp, stamp)

  // ---- Security regression: B is mistakenly granted the legacy Life OS
  // workspace. The grant must be live for B (its own session surfaces it) while
  // every task-card/routing endpoint still denies B, because the private surface
  // is bound to the stable legacy owner principal, not to the grant alone. ----
  fixtures.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
    .run(bId, 'ws_lifeos_legacy', stamp, 'test-fixture')
  const bSession = await api('/api/platform/session', { cookie: bCookie })
  assert.equal(bSession.status, 200)
  assert.ok((await bSession.json()).workspaces.some(workspace => workspace.workspaceId === 'ws_lifeos_legacy'),
    'B fixture grant must be live before denial is asserted')
  for (const [method, path, body] of [
    ['GET', `${CARD_API}/catalog`, undefined],
    ['GET', `${CARD_API}/routing`, undefined],
    ['PUT', `${CARD_API}/routing`, { type: 'bug', role: 'planner', provider: 'deepseek', model: deepseekModel }],
    ['DELETE', `${CARD_API}/routing?type=bug&role=planner`, undefined],
    ['GET', cardRoute(parentTask.id), undefined],
    ['PUT', cardRoute(parentTask.id), { type: 'bug', goal: '越权写入' }],
    ['DELETE', cardRoute(parentTask.id), undefined],
  ]) {
    const response = await api(path, {
      method, cookie: bCookie, body,
      headers: { 'x-workspace-subject': ownerName, 'x-platform-role': 'platform_admin' },
    })
    assert.equal(response.status, 404, `B with legacy grant ${method} ${path}`)
  }
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards WHERE account_id = ?').get(bId).n, 0,
    'a denied B write must not persist')

  const scopedCard = await api(cardRoute(parentTask.id), { cookie: ownerCookie })
  assert.equal(scopedCard.status, 200)
  const emptyCard = await bodyOf(scopedCard)
  assert.equal(emptyCard.card, null, 'another account/workspace card must not leak')
  assert.equal(emptyCard.task.id, parentTask.id)
  assert.deepEqual(emptyCard.routing, [], 'routing rows from another workspace must not leak')

  // ---- A CRUD, scoped by account + workspace + task id ----
  const cardPayload = {
    type: 'optimization',
    goal: '为任务卡建立持久的元数据与 Worker 路由',
    expectedArtifacts: ['0094 迁移', '/workbench/api/task-cards 接口'],
    subtaskIds: [subtask.id],
    dependencyIds: [dependencyId],
    roles: [
      { role: 'planner', provider: 'deepseek', model: deepseekModel, objective: '拆分步骤' },
      { role: 'developer', provider: 'deepseek', model: deepseekModel },
      { role: 'reviewer', provider: null, model: null },
    ],
    verification: ['迁移可重复执行', 'A 读写通过', 'B 与匿名被拒'],
    nextStep: '补充 UI 回归与后续研究切片',
    status: 'ready',
  }
  const created = await api(cardRoute(parentTask.id), { method: 'PUT', cookie: ownerCookie, body: cardPayload })
  assert.equal(created.status, 201)
  const createdCard = (await bodyOf(created)).card
  assert.equal(createdCard.type, 'optimization')
  assert.equal(createdCard.status, 'ready')
  assert.deepEqual(createdCard.subtaskIds, [subtask.id])
  assert.deepEqual(createdCard.dependencyIds, [dependencyId])
  assert.deepEqual(createdCard.roles.map(role => role.role).sort(), ['developer', 'planner', 'reviewer'])
  assert.deepEqual(createdCard.expectedArtifacts, cardPayload.expectedArtifacts)
  assert.deepEqual(createdCard.verification, cardPayload.verification)
  assert.equal(createdCard.nextStep, cardPayload.nextStep)
  assert.ok(createdCard.updatedAt)

  const reread = await bodyOf(await api(cardRoute(parentTask.id), { cookie: ownerCookie }))
  assert.equal(reread.card.goal, cardPayload.goal)
  assert.equal(reread.routing.length, 0)
  const entryRead = await api(cardRoute(parentTask.id), { cookie: entryCookie })
  assert.equal(entryRead.status, 200, 'the legacy entry-key session keeps Life OS read access')

  const updated = await api(cardRoute(parentTask.id), {
    method: 'PUT', cookie: ownerCookie,
    body: { ...cardPayload, goal: '更新后的目标', status: 'done' },
  })
  assert.equal(updated.status, 200)
  assert.equal((await bodyOf(updated)).card.goal, '更新后的目标')
  // A's write only touched A's own (account, workspace, task) row.
  assert.equal(fixtures.prepare('SELECT goal FROM lifeos_task_cards WHERE id = ?').get('card-intruder').goal, 'LEAK-INTRUDER')
  assert.equal(fixtures.prepare('SELECT goal FROM lifeos_task_cards WHERE id = ?').get('card-other-workspace').goal, 'LEAK-OTHER-WORKSPACE')
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, 3)

  const removed = await bodyOf(await api(cardRoute(parentTask.id), { method: 'DELETE', cookie: ownerCookie }))
  assert.equal(removed.deleted, true)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards WHERE id IN (?, ?)').get('card-intruder', 'card-other-workspace').n, 2)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards WHERE account_id = ? AND workspace_id = ?').get('acct_legacy_owner', 'ws_lifeos_legacy').n, 0)
  assert.equal((await bodyOf(await api(cardRoute(parentTask.id), { cookie: ownerCookie }))).card, null)
  assert.equal((await bodyOf(await api(cardRoute(parentTask.id), { method: 'DELETE', cookie: ownerCookie }))).deleted, false)
  assert.equal((await api(cardRoute(unknownTaskId), { cookie: ownerCookie })).status, 404)
  assert.equal((await api(cardRoute(unknownTaskId), { method: 'PUT', cookie: ownerCookie, body: cardPayload })).status, 404)

  // ---- Validation: card type, goal, status, lists, role set, task references
  // and worker ids are all rejected before anything is written. ----
  const rejectCard = async (body, code, label) => {
    const response = await api(cardRoute(parentTask.id), { method: 'PUT', cookie: ownerCookie, body })
    assert.equal(response.status, 400, `card ${label}`)
    const payload = await bodyOf(response)
    assert.equal(payload.code, code, `card ${label} → ${payload.code}`)
  }
  await rejectCard({ ...cardPayload, type: 'other' }, 'INVALID_TASK_CARD_TYPE', 'unknown type')
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
  await rejectCard({ ...cardPayload, subtaskIds: [otherTask.id] }, 'INVALID_SUBTASK_REFERENCE', 'subtask of another task')
  await rejectCard({ ...cardPayload, subtaskIds: [uuid(9)] }, 'INVALID_SUBTASK_REFERENCE', 'missing subtask')
  await rejectCard({ ...cardPayload, dependencyIds: ['dep-fixture-other'] }, 'INVALID_DEPENDENCY_REFERENCE', 'dependency of another task')
  await rejectCard({ ...cardPayload, dependencyIds: [uuid(8)] }, 'INVALID_DEPENDENCY_REFERENCE', 'missing dependency')
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
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards WHERE account_id = ? AND workspace_id = ? AND task_id = ?')
    .get('acct_legacy_owner', 'ws_lifeos_legacy', parentTask.id).n, 0, 'rejected writes must not persist')

  // ---- Worker routing: platform-admin writes only, catalog ids only ----
  for (const [method, path, body] of [
    ['GET', `${CARD_API}/routing`, undefined],
    ['PUT', `${CARD_API}/routing`, { type: 'bug', role: 'planner', provider: 'deepseek', model: deepseekModel }],
    ['DELETE', `${CARD_API}/routing?type=bug&role=planner`, undefined],
  ]) {
    const response = await api(path, { method, cookie: entryCookie, body })
    if (method === 'GET') {
      // The legacy entry-key session is account A, so reads are allowed; it is
      // simply not a platform admin.
      assert.equal(response.status, 200)
      continue
    }
    assert.equal(response.status, 403, `legacy entry-key ${method} routing`)
    assert.equal((await bodyOf(response)).code, 'FORBIDDEN')
  }
  const routingPut = await api(`${CARD_API}/routing`, {
    method: 'PUT', cookie: ownerCookie,
    body: { type: 'bug', role: 'planner', provider: 'deepseek', model: deepseekModel },
  })
  assert.equal(routingPut.status, 200)
  assert.equal((await bodyOf(routingPut)).routing.ready, true)
  const routingList = await bodyOf(await api(`${CARD_API}/routing`, { cookie: ownerCookie }))
  assert.equal(routingList.routing.length, 1)
  assert.equal(routingList.routing[0].type, 'bug')
  assert.equal(routingList.routing[0].role, 'planner')
  assert.equal(routingList.routing[0].provider, 'deepseek')
  assert.equal(routingList.routing[0].model, deepseekModel)
  assert.equal(routingList.routing[0].ready, true)
  assert.equal(routingList.routing[0].updatedBy, ownerName)
  const catalogWithRouting = await bodyOf(await api(`${CARD_API}/catalog`, { cookie: ownerCookie }))
  assert.equal(catalogWithRouting.routing.length, 1)

  const rejectRouting = async (body, code, label) => {
    const response = await api(`${CARD_API}/routing`, { method: 'PUT', cookie: ownerCookie, body })
    assert.equal(response.status, 400, `routing ${label}`)
    assert.equal((await bodyOf(response)).code, code, `routing ${label}`)
  }
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'openai', model: 'gpt-4.1-mini' }, 'WORKER_MODEL_NOT_READY', 'provider not ready')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'gemini', model: 'gemini-2.0-flash' }, 'WORKER_MODEL_NOT_READY', 'invented gemini model')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'deepseek', model: 'deepseek-flash' }, 'WORKER_MODEL_NOT_READY', 'model absent from catalog')
  await rejectRouting({ type: 'bug', role: 'owner', provider: 'deepseek', model: deepseekModel }, 'INVALID_TASK_CARD_ROLE', 'unknown role')
  await rejectRouting({ type: 'other', role: 'planner', provider: 'deepseek', model: deepseekModel }, 'INVALID_TASK_CARD_TYPE', 'unknown type')
  await rejectRouting({ type: 'bug', role: 'planner', provider: 'deepseek' }, 'INVALID_WORKER_SELECTION', 'missing model')
  assert.equal((await api(`${CARD_API}/routing?type=bug&role=owner`, { method: 'DELETE', cookie: ownerCookie })).status, 400)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing WHERE account_id = ? AND workspace_id = ?')
    .get('acct_legacy_owner', 'ws_lifeos_legacy').n, 1)

  // ---- Migration 0094 is recorded, additive and safely rerunnable ----
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_schema_migrations WHERE name = ?')
    .get('0094_lifeos_task_cards.sql').n, 1)
  const migrationSql = readFileSync(join(root, 'migrations', '0094_lifeos_task_cards.sql'), 'utf8')
  const cardsBeforeRerun = fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n
  fixtures.exec(migrationSql)
  fixtures.exec(migrationSql)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, cardsBeforeRerun)
  assert.equal(fixtures.prepare('PRAGMA foreign_key_check').all().length, 0)
  const fresh = new DatabaseSync(':memory:')
  fresh.exec(migrationSql)
  fresh.exec(migrationSql)
  const freshTables = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name)
  assert.ok(freshTables.includes('lifeos_task_cards'))
  assert.ok(freshTables.includes('lifeos_task_worker_routing'))
  fresh.close()

  // A card written after the rerun still round-trips.
  assert.equal((await api(cardRoute(parentTask.id), { method: 'PUT', cookie: ownerCookie, body: cardPayload })).status, 201)
  assert.equal((await bodyOf(await api(cardRoute(parentTask.id), { cookie: ownerCookie }))).card.goal, cardPayload.goal)
  // Routing is returned for the card's own type (`optimization`); the only
  // seeded route is `bug/planner`, whose defaults are covered above, so no
  // optimization route leaks into this card's response.
  assert.deepEqual((await bodyOf(await api(cardRoute(parentTask.id), { cookie: ownerCookie }))).routing, [],
    'only routes matching the card type are returned')

  // ---- The 40-collection Life OS export/import/reset contract is unchanged ----
  const exported = await bodyOf(await api('/api/personal-workbench/lifeos/data/export', { cookie: ownerCookie }))
  assert.equal(exported.version, '1.1.0')
  const exportKeys = Object.keys(exported.data)
  assert.equal(exportKeys.length, 41)
  assert.deepEqual(exportKeys.filter(key => /card|routing|worker/i.test(key)), [])
  const unknownImport = await api('/api/personal-workbench/lifeos/data/import', {
    method: 'POST', cookie: ownerCookie, body: { version: '1.1.0', data: { taskCards: [] } },
  })
  assert.equal(unknownImport.status, 400)
  assert.deepEqual((await bodyOf(unknownImport)).unknown, ['taskCards'])
  const cardsBeforeReset = fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n
  // The routing table is deliberately seeded with the platform-admin
  // `ws_lifeos_legacy` row alongside the `ws_ops_meta` fixture row, so the
  // reset must preserve whatever the full table holds at this point.
  const routingBeforeReset = fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing').get().n
  assert.equal((await api('/api/personal-workbench/lifeos/data/reset', { method: 'DELETE', cookie: ownerCookie })).status, 200)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_cards').get().n, cardsBeforeReset)
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_task_worker_routing').get().n, routingBeforeReset)

  console.log('Task-card + Worker-routing boundary checks passed: grant/IDOR denial, A CRUD, validation, catalog readiness, Gemini labelling, routing policy, migration rerun, export/reset boundary and view contract.')
} finally {
  child.kill('SIGTERM')
  agent.close()
  await new Promise(resolve => setTimeout(resolve, 200))
  try { fixtures?.close() } catch {}
  rmSync(temp, { recursive: true, force: true })
}
