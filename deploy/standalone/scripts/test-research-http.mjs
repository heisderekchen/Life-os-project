// Server-boundary acceptance (HTTP/loopback) for the research state-machine and
// the disabled Obsidian interface. Loopback sockets are required, so it runs in
// CI (like test-task-cards-http.mjs). It uses SQLite fixtures and a fake AI
// service health probe only: no real provider key and no provider call.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
const temp = mkdtempSync(join(tmpdir(), 'lifeos-research-'))
const dbPath = join(temp, 'lifeos.db')
const nextDir = join(temp, 'next')
mkdirSync(nextDir)
writeFileSync(join(nextDir, 'server.js'), [
  "const http=require('node:http');",
  'http.createServer((req,res)=>{res.writeHead(200,',
  "{'content-type':'text/html'});res.end('mock next '+req.url)})",
  ".listen(Number(process.env.PORT),'127.0.0.1')",
].join(''))
const agent = createHttpServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', persistence: 'fixture', taskTrigger: 'approved_worker', providers: { deepseek: true, openai: false } }))
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
    PLATFORM_WORKSPACES_JSON: JSON.stringify([{ id: 'ws_ops_meta', slug: 'ops', displayName: '运营工作区', configured: false }]),
    LIFEOS_RECURRENCE_ENABLED: 'false',
    AGENT_SERVICE_URL: `http://127.0.0.1:${agentPort}`,
    AGENT_SERVICE_TOKEN: 'test-service-token',
    WORKSPACE_SUBJECT_SIGNING_SECRET: 'test-signing-secret',
  },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${port}`
const proxyHeaders = { 'x-forwarded-proto': 'https' }
const jsonHeaders = { ...proxyHeaders, origin, 'content-type': 'application/json' }
const RESEARCH_API = '/workbench/api/research'
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
  return fetch(`${base}${path}`, { method, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const bodyOf = async response => {
  const value = await response.text()
  try { return value ? JSON.parse(value) : {} } catch { return { text: value } }
}
const planBody = {
  mode: 'continuous', goal: '核对外部公开资料', target: 'https://example.com',
  sourceAllowlist: ['user_provided_reference'], actionAllowlist: ['deduplicate_evidence'], unresolvedQuestions: ['是否仍成立？'],
  nextQuestion: '有无更新？', checkpoint: { stage: 'intake' }, costLimitUsd: 1,
  frequencyMinutes: 60, subtaskCap: 1, maxConcurrency: 1, maxRounds: 5,
}
let fixtures = null
try {
  await waitReady()
  // Anonymous callers never see the surface at all.
  for (const [method, path, body] of [
    ['GET', `${RESEARCH_API}/catalog`, undefined],
    ['GET', `${RESEARCH_API}/obsidian/status`, undefined],
    ['GET', `${RESEARCH_API}/tasks/unknown-task/obsidian/status`, undefined],
    ['GET', `${RESEARCH_API}/tasks/unknown-task`, undefined],
    ['PUT', `${RESEARCH_API}/tasks/unknown-task`, planBody],
    ['POST', `${RESEARCH_API}/tasks/unknown-task/start`, undefined],
  ]) {
    assert.equal((await api(path, { method, body })).status, 404, `anonymous ${method} ${path}`)
  }
  // Owner bootstrap + legacy entry-key session + unified platform login.
  assert.equal((await api('/api/personal-workbench/owner-credential', {
    method: 'POST', body: { setupKey, password: ownerPassword, confirmPassword: ownerPassword },
  })).status, 204)
  const entry = await api('/api/personal-workbench/entry', { method: 'POST', body: { key: 'test-only-entry-key' } })
  assert.equal(entry.status, 204)
  const entryCookie = cookieOf(entry)
  const ownerLogin = await api('/api/platform/login', { method: 'POST', body: { username: ownerName, password: ownerPassword } })
  assert.equal(ownerLogin.status, 200)
  const ownerCookie = cookieOf(ownerLogin)
  // Account B: a plain member granted only a different workspace.
  const createB = await api('/api/platform/admin/accounts', { method: 'POST', cookie: ownerCookie, body: { username: 'member-b', displayName: '成员 B' } })
  assert.equal(createB.status, 201)
  const bId = (await createB.json()).account.accountId
  assert.equal((await api(`/api/platform/admin/accounts/${bId}/password`, { method: 'POST', cookie: ownerCookie, body: { password: bPassword } })).status, 204)
  const bLogin = await api('/api/platform/login', { method: 'POST', body: { username: 'member-b', password: bPassword } })
  assert.equal(bLogin.status, 200)
  const bCookie = cookieOf(bLogin)
  assert.equal((await api(`/api/platform/admin/accounts/${bId}/workspaces`, { method: 'POST', cookie: ownerCookie, body: { workspaceId: 'ws_ops_meta', granted: true } })).status, 200)
  const createTask = await api('/workbench/api/tasks', { method: 'POST', cookie: ownerCookie, body: { title: '研究任务 A' } })
  assert.equal(createTask.status, 201)
  const taskId = (await bodyOf(createTask)).id
  fixtures = new DatabaseSync(dbPath)
  fixtures.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
  // ---- Security regression: B is mistakenly granted the legacy Life OS
  // workspace. The grant is live for B, yet every research endpoint denies it. ----
  fixtures.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
    .run(bId, 'ws_lifeos_legacy', '2026-10-11T00:00:00.000Z', 'test-fixture')
  const bSession = await api('/api/platform/session', { cookie: bCookie })
  assert.ok((await bSession.json()).workspaces.some(workspace => workspace.workspaceId === 'ws_lifeos_legacy'), 'B fixture grant must be live before denial is asserted')
  for (const [method, path, body] of [
    ['GET', `${RESEARCH_API}/catalog`, undefined],
    ['GET', `${RESEARCH_API}/tasks/${taskId}/obsidian/status`, undefined],
    ['GET', `${RESEARCH_API}/tasks/${taskId}`, undefined],
    ['PUT', `${RESEARCH_API}/tasks/${taskId}`, planBody],
    ['POST', `${RESEARCH_API}/tasks/${taskId}/start`, undefined],
    ['POST', `${RESEARCH_API}/tasks/${taskId}/obsidian`, { relativePath: 'Life OS/Research/x.md', title: 't', body: 'b' }],
    ['DELETE', `${RESEARCH_API}/tasks/${taskId}`, undefined],
  ]) {
    const response = await api(path, { method, cookie: bCookie, body, headers: { 'x-workspace-subject': ownerName, 'x-platform-role': 'platform_admin' } })
    assert.equal(response.status, 404, `B ${method} ${path}`)
  }
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_research_sessions WHERE account_id = ?').get(bId).n, 0, 'a denied B write must not persist')
  // ---- Catalog: caps + explicit unavailability, no secrets ----
  const catalogText = await (await api(`${RESEARCH_API}/catalog`, { cookie: ownerCookie })).text()
  const catalog = JSON.parse(catalogText)
  assert.equal(catalog.executor.connected, false)
  assert.equal(catalog.executor.message, '等待 Neo/研究执行器连接')
  assert.equal(catalog.obsidian.enabled, false)
  assert.equal(catalog.caps.maxRounds, 20)
  assert.equal(catalog.caps.maxConcurrency, 1)
  assert.equal(catalog.caps.maxCostLimitUsd, 1)
  assert.equal(catalog.caps.minFrequencyMinutes, 60)
  assert.deepEqual(catalog.sources.map(entry => entry.id), ['user_provided_reference', 'selected_obsidian_reference'])
  assert.equal(/API_KEY|api_key|secret|token|sk-|fixture-owner-password|test-only-/i.test(catalogText), false)
  // ---- Plan -> draft, never runs; explicit start -> waiting_executor ----
  const planned = await api(`${RESEARCH_API}/tasks/${taskId}`, { method: 'PUT', cookie: ownerCookie, body: planBody })
  assert.equal(planned.status, 201)
  assert.equal((await bodyOf(planned)).session.status, 'draft')
  const start = await api(`${RESEARCH_API}/tasks/${taskId}/start`, { method: 'POST', cookie: ownerCookie })
  assert.equal(start.status, 200)
  const started = await bodyOf(start)
  assert.equal(started.session.status, 'waiting_executor')
  assert.notEqual(started.session.status, 'running')
  assert.equal(started.executor.message, '等待 Neo/研究执行器连接')
  // The executor round intake is closed because no executor is connected.
  const rounds = await api(`${RESEARCH_API}/tasks/${taskId}/rounds`, { method: 'POST', cookie: ownerCookie, body: { evidence: [] } })
  assert.equal(rounds.status, 409)
  assert.equal((await bodyOf(rounds)).code, 'EXECUTOR_NOT_CONNECTED')
  // ---- Pause / resume / cancel ----
  assert.equal((await bodyOf(await api(`${RESEARCH_API}/tasks/${taskId}/pause`, { method: 'POST', cookie: ownerCookie }))).session.status, 'paused')
  assert.equal((await api(`${RESEARCH_API}/tasks/${taskId}/pause`, { method: 'POST', cookie: ownerCookie })).status, 409)
  assert.equal((await bodyOf(await api(`${RESEARCH_API}/tasks/${taskId}/resume`, { method: 'POST', cookie: ownerCookie }))).session.status, 'waiting_executor')
  assert.equal((await bodyOf(await api(`${RESEARCH_API}/tasks/${taskId}/cancel`, { method: 'POST', cookie: ownerCookie }))).session.status, 'cancelled')
  // ---- Cap enforcement over HTTP (finite budget + 60-minute lower bound) ----
  const overCap = await api(`${RESEARCH_API}/tasks/${taskId}`, { method: 'PUT', cookie: ownerCookie, body: { ...planBody, maxConcurrency: 99 } })
  assert.equal(overCap.status, 400)
  assert.equal((await bodyOf(overCap)).code, 'EXCEEDS_SERVER_CAP')
  const zeroBudget = await api(`${RESEARCH_API}/tasks/${taskId}`, { method: 'PUT', cookie: ownerCookie, body: { ...planBody, costLimitUsd: 0 } })
  assert.equal(zeroBudget.status, 400)
  assert.equal((await bodyOf(zeroBudget)).code, 'INVALID_COST_LIMIT')
  const slowPoll = await api(`${RESEARCH_API}/tasks/${taskId}`, { method: 'PUT', cookie: ownerCookie, body: { ...planBody, frequencyMinutes: 30 } })
  assert.equal(slowPoll.status, 400)
  assert.equal((await bodyOf(slowPoll)).code, 'INVALID_FREQUENCY')
  const unknownOption = await api(`${RESEARCH_API}/tasks/${taskId}`, { method: 'PUT', cookie: ownerCookie, body: { ...planBody, actionAllowlist: ['run_web_crawl'] } })
  assert.equal(unknownOption.status, 400)
  assert.equal((await bodyOf(unknownOption)).code, 'UNKNOWN_OPTION')
  // ---- Obsidian staging: pending_sync only, never a filesystem write ----
  const stagePath = 'Life OS/Research/topic.md'
  const staged = await api(`${RESEARCH_API}/tasks/${taskId}/obsidian`, {
    method: 'POST', cookie: ownerCookie,
    body: { relativePath: stagePath, title: '公开资料核对', body: '增量结论。', citations: ['example.com/r1'] },
  })
  assert.equal(staged.status, 201)
  const stagedBody = await bodyOf(staged)
  assert.equal(stagedBody.staged.status, 'pending_sync')
  assert.equal(stagedBody.obsidian.enabled, false)
  assert.equal((await api(`${RESEARCH_API}/tasks/${taskId}/obsidian`, {
    method: 'POST', cookie: ownerCookie, body: { relativePath: '../evil.md', title: 't', body: 'b' },
  })).status, 400)
  assert.equal((await api(`${RESEARCH_API}/obsidian/status`, { cookie: ownerCookie })).status, 404, 'the workspace-wide outbox route is removed')
  const status = await bodyOf(await api(`${RESEARCH_API}/tasks/${taskId}/obsidian/status`, { cookie: ownerCookie }))
  assert.equal(status.taskId, taskId)
  assert.equal(status.obsidian.enabled, false)
  assert.equal(status.obsidian.pendingCount, 1)
  assert.equal(status.outbox[0].relativePath, stagePath)
  // The legacy entry-key session keeps read access but is not needed to write.
  assert.equal((await api(`${RESEARCH_API}/tasks/${taskId}`, { cookie: entryCookie })).status, 200)
  // ---- Mutation guards: same-origin + JSON content-type ----
  assert.equal((await api(`${RESEARCH_API}/tasks/${taskId}/start`, {
    method: 'POST', cookie: ownerCookie, headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
  })).status, 404, 'a cross-origin mutation is refused')
  assert.equal((await api(`${RESEARCH_API}/tasks/${taskId}`, {
    method: 'PUT', cookie: ownerCookie, headers: { ...proxyHeaders, origin, 'content-type': 'text/plain' },
  })).status, 415, 'a non-JSON mutation body is refused')
  // ---- Migration 0095 is recorded and safely rerunnable ----
  assert.equal(fixtures.prepare('SELECT COUNT(*) AS n FROM lifeos_schema_migrations WHERE name = ?')
    .get('0095_lifeos_research_state.sql').n, 1)
  assert.equal(fixtures.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('Research boundary checks passed: grant/IDOR denial, draft/start/pause/resume/cancel, closed executor intake, cap enforcement, pending-sync staging and mutation guards.')
} finally {
  child.kill('SIGTERM')
  agent.close()
  await new Promise(resolve => setTimeout(resolve, 200))
  try { fixtures?.close() } catch {}
  rmSync(temp, { recursive: true, force: true })
}
