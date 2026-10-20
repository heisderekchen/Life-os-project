// In-memory acceptance for the research state-machine + disabled Obsidian
// interface: migration rerun, scope/IDOR denial, cap enforcement, lifecycle,
// deterministic dedupe/backoff/terminal engine, pending-sync staging, the
// Obsidian adapter conflict contract and the unchanged export/reset boundary.
// It needs no sockets; the loopback/HTTP variant lives in test-research-http.mjs.
// Fixtures are anonymous SQLite rows only; no real vault or provider is touched.
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
import {
  EXECUTOR_WAITING_MESSAGE, OBSIDIAN_DEFAULT_FOLDER, RESEARCH_EXECUTION_CAPS,
  applyResearchRound, buildObsidianBlock, createInMemoryObsidianAdapter, evidenceDedupeKey, handleResearchApi,
  normalizeRelativePath,
} from '../src/research.mjs'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = join(root, '..', '..')
const OWNER = 'lifeos-owner'
const AUTH_SECRET = 'test-only-auth-secret'
const ENTRY_KEY = 'test-only-entry-key'
const STAMP = '2026-10-11T00:00:00.000Z'
const RESEARCH_PREFIX = '/workbench/api/research'
// ---- Schema: every migration, then an explicit rerun of the new one ----
const migrationDir = join(root, 'migrations')
const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()
const migrationSql = name => readFileSync(join(migrationDir, name), 'utf8')
assert.ok(migrationNames.includes('0095_lifeos_research_state.sql'))
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec("CREATE TABLE IF NOT EXISTS lifeos_schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))")
const markMigration = db.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of migrationNames) {
  db.exec('BEGIN IMMEDIATE')
  try { db.exec(migrationSql(name)); markMigration.run(name); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
db.exec(migrationSql('0095_lifeos_research_state.sql'))
db.exec(migrationSql('0095_lifeos_research_state.sql'))
const researchTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all().map(row => row.name)
for (const table of ['lifeos_research_evidence', 'lifeos_research_rounds', 'lifeos_research_sessions', 'lifeos_obsidian_sync_outbox']) {
  assert.ok(researchTables.includes(table), `${table} must exist after the migration`)
}
const env = {
  DB: createD1Sqlite(db),
  AUTH_SECRET,
  PERSONAL_WORKBENCH_ENTRY_KEY: ENTRY_KEY,
  PERSONAL_WORKBENCH_OWNER: OWNER,
  ENVIRONMENT: 'production',
  PLATFORM_WORKSPACES_JSON: JSON.stringify([
    { id: 'ws_ops_meta', slug: 'ops', displayName: '运营工作区', configured: false },
  ]),
}
await ensurePlatformBootstrap(env)
await syncConfiguredWorkspaces(env)
// ---- Fixtures: account A's Life OS tasks plus a member account B ----
const insertTask = db.prepare('INSERT INTO personal_workbench_lifeos_tasks (id,title,status,priority,position,archived,created_at,updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)')
insertTask.run('task-alpha', '研究任务 A', 'todo', 'medium', STAMP, STAMP)
insertTask.run('task-beta', '研究任务 B', 'todo', 'medium', STAMP, STAMP)
db.prepare('INSERT INTO platform_accounts (account_id, username, display_name, role, legacy_owner, enabled, session_version, failed_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, 1, 0, ?, ?)')
  .run('acct_b', 'member-b', '成员 B', 'member', STAMP, STAMP)
db.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
  .run('acct_b', 'ws_ops_meta', STAMP, 'test-fixture')
// Security regression fixture: B is a plain member who is *also* mistakenly
// granted the legacy Life OS workspace. The grant alone must never open the
// private surface; only the stable legacy owner principal may use it.
db.prepare('INSERT INTO platform_account_workspaces (account_id, workspace_id, granted_at, granted_by) VALUES (?, ?, ?, ?)')
  .run('acct_b', LEGACY_WORKSPACE_ID, STAMP, 'test-fixture')
const ownerPrincipal = await resolvePrincipal(env, issueAccountSessionToken(AUTH_SECRET, LEGACY_ACCOUNT_ID, 1))
const entryPrincipal = await resolvePrincipal(env, issueSessionToken(AUTH_SECRET, ENTRY_KEY, OWNER))
const memberPrincipal = await resolvePrincipal(env, issueAccountSessionToken(AUTH_SECRET, 'acct_b', 1))
assert.equal(memberPrincipal.legacyOwner, false)
const bState = await workspacePageState(env, memberPrincipal, 'lifeos')
assert.equal(bState.status, 'configured', 'B fixture grant must be a real, resolvable grant')
const jsonOf = async response => JSON.parse(await response.text())
async function call(principal, method, path, body, executorConnected = false) {
  const url = new URL(`https://lifeos.test${RESEARCH_PREFIX}${path}`)
  const request = new Request(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await handleResearchApi(request, env, url, principal, { basePath: '/workbench', executorConnected })
  return response || new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}
const planBody = {
  mode: 'continuous',
  goal: '核对外部公开资料并形成可复核结论',
  target: 'https://example.com/topic',
  sourceAllowlist: ['user_provided_reference'],
  actionAllowlist: ['deduplicate_evidence', 'draft_next_question'],
  unresolvedQuestions: ['结论是否仍然成立？'],
  nextQuestion: '是否有更新的官方说明？',
  checkpoint: { stage: 'intake', verified: [] },
  costLimitUsd: 1,
  frequencyMinutes: 60,
  subtaskCap: 1,
  maxConcurrency: 1,
  maxRounds: 10,
}
try {
  // ---- Anonymous / B / forged denial (no existence disclosure). B is probed
  // while holding its real ws_lifeos_legacy grant, so the legacy-owner binding
  // (not a missing grant) is what denies it. ----
  const probes = [
    ['GET', '/catalog', undefined],
    ['GET', '/obsidian/status', undefined],
    ['GET', '/tasks/task-alpha/obsidian/status', undefined],
    ['GET', '/tasks/task-alpha', undefined],
    ['PUT', '/tasks/task-alpha', planBody],
    ['POST', '/tasks/task-alpha/start', undefined],
    ['DELETE', '/tasks/task-alpha', undefined],
    ['POST', '/tasks/task-alpha/obsidian', { relativePath: `${OBSIDIAN_DEFAULT_FOLDER}/x.md`, title: 't', body: 'b' }],
  ]
  for (const [method, path, body] of probes) {
    for (const candidate of [null, memberPrincipal]) {
      assert.equal((await call(candidate, method, path, body)).status, 404, `${candidate ? 'B' : 'anonymous'} ${method} ${path}`)
    }
  }
  assert.equal((await call(await resolvePrincipal(env, 'forged-token'), 'GET', '/catalog')).status, 404)
  // Disable / revoke are re-checked per request: disabling the owner account or
  // bumping its session version invalidates a still-signed token immediately.
  const ownerToken = issueAccountSessionToken(AUTH_SECRET, LEGACY_ACCOUNT_ID, 1)
  assert.equal((await call(await resolvePrincipal(env, ownerToken), 'GET', '/catalog')).status, 200)
  db.prepare('UPDATE platform_accounts SET enabled = 0 WHERE account_id = ?').run(LEGACY_ACCOUNT_ID)
  assert.equal(await resolvePrincipal(env, ownerToken), null)
  assert.equal((await call(await resolvePrincipal(env, ownerToken), 'GET', '/catalog')).status, 404, 'a disabled owner is denied')
  db.prepare('UPDATE platform_accounts SET enabled = 1, session_version = 2 WHERE account_id = ?').run(LEGACY_ACCOUNT_ID)
  assert.equal((await call(await resolvePrincipal(env, ownerToken), 'GET', '/catalog')).status, 404, 'a revoked session version is denied')
  db.prepare('UPDATE platform_accounts SET session_version = 1 WHERE account_id = ?').run(LEGACY_ACCOUNT_ID)
  assert.equal((await call(await resolvePrincipal(env, ownerToken), 'GET', '/catalog')).status, 200)
  // ---- Catalog: caps + explicit executor/Obsidian unavailability, no secrets ----
  const catalogText = await (await call(ownerPrincipal, 'GET', '/catalog')).text()
  const catalog = JSON.parse(catalogText)
  assert.equal(catalog.caps.maxRounds, RESEARCH_EXECUTION_CAPS.maxRounds)
  assert.equal(catalog.caps.maxConcurrency, RESEARCH_EXECUTION_CAPS.maxConcurrency)
  assert.equal(catalog.caps.maxConcurrency, 1)
  assert.equal(catalog.caps.maxSubtasks, 1)
  assert.equal(catalog.caps.maxCostLimitUsd, 1)
  assert.equal(catalog.caps.minFrequencyMinutes, 60)
  assert.deepEqual(catalog.modes.map(entry => entry.id), ['once', 'continuous'])
  assert.deepEqual(catalog.statuses.map(entry => entry.id), ['draft', 'waiting_executor', 'paused', 'cancelled', 'stopped'])
  // Server-owned immutable option catalogs: abstract, safe, no fetch/model action.
  assert.deepEqual(catalog.sources.map(entry => entry.id), ['user_provided_reference', 'selected_obsidian_reference'])
  assert.deepEqual(catalog.actions.map(entry => entry.id), ['deduplicate_evidence', 'draft_next_question', 'stage_obsidian_artifact'])
  assert.equal(/fetch|browse|http|crawl|model|provider/i.test(catalogText), false, 'option catalogs must not name web/model actions')
  assert.equal(catalog.executor.connected, false)
  assert.equal(catalog.executor.message, EXECUTOR_WAITING_MESSAGE)
  assert.equal(catalog.obsidian.enabled, false)
  assert.equal(catalog.obsidian.configured, false)
  assert.equal(catalog.obsidian.reason, 'filesystem_permission_pending')
  assert.equal(/API_KEY|api_key|secret|bearer|sk-|test-only-auth-secret|test-only-entry-key/i.test(catalogText), false)
  // ---- Scope IDOR: a same-task session owned by another account/workspace must
  // never be read, written or deleted through A's surface. ----
  db.prepare("INSERT INTO lifeos_research_sessions (id, account_id, workspace_id, task_id, mode, goal, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'once', ?, 'draft', ?, ?)")
    .run('s-intruder', 'acct_intruder', LEGACY_WORKSPACE_ID, 'task-alpha', 'LEAK-INTRUDER', STAMP, STAMP)
  db.prepare("INSERT INTO lifeos_research_sessions (id, account_id, workspace_id, task_id, mode, goal, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'once', ?, 'draft', ?, ?)")
    .run('s-other-workspace', LEGACY_ACCOUNT_ID, 'ws_ops_meta', 'task-alpha', 'LEAK-OTHER-WS', STAMP, STAMP)
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha'))).session, null, 'another account/workspace session must not leak')
  // ---- Plan/create is a draft and never runs ----
  const created = await call(ownerPrincipal, 'PUT', '/tasks/task-alpha', planBody)
  assert.equal(created.status, 201)
  const createdSession = (await jsonOf(created)).session
  assert.equal(createdSession.status, 'draft')
  assert.equal(createdSession.costSpentUsd, 0)
  assert.equal(createdSession.costLimitUsd, 1, 'the exact $1 server cap is accepted')
  assert.equal(createdSession.maxConcurrency, 1)
  assert.equal(createdSession.roundCount, 0)
  assert.deepEqual(createdSession.sourceAllowlist, planBody.sourceAllowlist)
  assert.deepEqual(createdSession.actionAllowlist, planBody.actionAllowlist)
  assert.deepEqual(createdSession.checkpoint, planBody.checkpoint)
  assert.equal(createdSession.executor.connected, false)
  assert.equal(createdSession.executor.message, EXECUTOR_WAITING_MESSAGE)
  assert.equal((await jsonOf(await call(entryPrincipal, 'GET', '/tasks/task-alpha'))).session.status, 'draft', 'legacy entry-key keeps read access')
  assert.equal((await call(ownerPrincipal, 'PUT', '/tasks/task-missing', planBody)).status, 404)
  assert.equal((await call(ownerPrincipal, 'GET', '/tasks/..%2Ftask-alpha')).status, 404)
  // ---- Server-owned caps: every value above a cap is rejected before a write ----
  const rejectCap = async (patch, code, label) => {
    const response = await call(ownerPrincipal, 'PUT', '/tasks/task-alpha', { ...planBody, ...patch })
    assert.equal(response.status, 400, `cap ${label}`)
    assert.equal((await jsonOf(response)).code, code, `cap ${label}`)
  }
  await rejectCap({ costLimitUsd: RESEARCH_EXECUTION_CAPS.maxCostLimitUsd + 1 }, 'EXCEEDS_SERVER_CAP', 'budget')
  await rejectCap({ costLimitUsd: 0 }, 'INVALID_COST_LIMIT', 'budget zero')
  await rejectCap({ costLimitUsd: -1 }, 'INVALID_COST_LIMIT', 'budget negative')
  await rejectCap({ costLimitUsd: 1.5 }, 'EXCEEDS_SERVER_CAP', 'budget above cap')
  await rejectCap({ frequencyMinutes: RESEARCH_EXECUTION_CAPS.maxFrequencyMinutes + 1 }, 'EXCEEDS_SERVER_CAP', 'frequency high')
  await rejectCap({ frequencyMinutes: 0 }, 'INVALID_FREQUENCY', 'frequency low')
  await rejectCap({ frequencyMinutes: 30 }, 'INVALID_FREQUENCY', 'frequency below 60-minute lower bound')
  await rejectCap({ maxConcurrency: RESEARCH_EXECUTION_CAPS.maxConcurrency + 1 }, 'EXCEEDS_SERVER_CAP', 'concurrency')
  await rejectCap({ subtaskCap: RESEARCH_EXECUTION_CAPS.maxSubtasks + 1 }, 'EXCEEDS_SERVER_CAP', 'subtask cap')
  await rejectCap({ maxRounds: RESEARCH_EXECUTION_CAPS.maxRounds + 1 }, 'EXCEEDS_SERVER_CAP', 'max rounds')
  await rejectCap({ sourceAllowlist: Array.from({ length: RESEARCH_EXECUTION_CAPS.maxSources + 1 }, (_, i) => `s${i}.example`) }, 'INVALID_SOURCE_ALLOWLIST', 'too many sources')
  await rejectCap({ actionAllowlist: Array.from({ length: RESEARCH_EXECUTION_CAPS.maxActions + 1 }, (_, i) => `a${i}`) }, 'INVALID_ACTION_ALLOWLIST', 'too many actions')
  await rejectCap({ sourceAllowlist: ['https://example.com'] }, 'UNKNOWN_OPTION', 'unknown source option')
  await rejectCap({ actionAllowlist: ['fetch_web'] }, 'UNKNOWN_OPTION', 'unknown action option')
  await rejectCap({ goal: '' }, 'INVALID_GOAL', 'empty goal')
  await rejectCap({ mode: 'always' }, 'INVALID_MODE', 'bad mode')
  await rejectCap({ checkpoint: 'not-an-object' }, 'INVALID_CHECKPOINT', 'bad checkpoint')
  await rejectCap({ checkpoint: { blob: 'x'.repeat(RESEARCH_EXECUTION_CAPS.maxCheckpointChars + 10) } }, 'EXCEEDS_SERVER_CAP', 'checkpoint size')
  assert.equal(db.prepare('SELECT mode FROM lifeos_research_sessions WHERE task_id = ? AND workspace_id = ? AND account_id = ?')
    .get('task-alpha', LEGACY_WORKSPACE_ID, LEGACY_ACCOUNT_ID).mode, 'continuous', 'a rejected plan must not persist')
  // ---- Re-planning without history is a bounded draft update ----
  const betaCreated = await call(ownerPrincipal, 'PUT', '/tasks/task-beta', { ...planBody, costLimitUsd: undefined })
  assert.equal(betaCreated.status, 201)
  assert.equal((await jsonOf(betaCreated)).session.costLimitUsd, RESEARCH_EXECUTION_CAPS.maxCostLimitUsd, 'a missing budget uses the safe server-owned default')
  const betaUpdate = await call(ownerPrincipal, 'PUT', '/tasks/task-beta', { ...planBody, mode: 'once', maxRounds: 1 })
  assert.equal(betaUpdate.status, 200, 'a draft with no history can be updated')
  assert.equal((await jsonOf(betaUpdate)).session.status, 'draft')
  // ---- Existing-task validation on GET and every lifecycle route ----
  // An orphan research row whose task id does not exist in
  // personal_workbench_lifeos_tasks is neither readable nor transitionable.
  db.prepare("INSERT INTO lifeos_research_sessions (id, account_id, workspace_id, task_id, mode, goal, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'once', ?, 'draft', ?, ?)")
    .run('s-orphan', LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID, 'task-orphan', 'LEAK-ORPHAN', STAMP, STAMP)
  for (const [method, path, body] of [
    ['GET', '/tasks/task-orphan', undefined],
    ['GET', '/tasks/task-orphan/obsidian/status', undefined],
    ['PUT', '/tasks/task-orphan', planBody],
    ['POST', '/tasks/task-orphan/start', undefined],
    ['POST', '/tasks/task-orphan/pause', undefined],
    ['POST', '/tasks/task-orphan/resume', undefined],
    ['POST', '/tasks/task-orphan/cancel', undefined],
    ['POST', '/tasks/task-orphan/rounds', { evidence: [] }],
    ['POST', '/tasks/task-orphan/obsidian', { relativePath: `${OBSIDIAN_DEFAULT_FOLDER}/x.md`, title: 't', body: 'b' }],
  ]) {
    assert.equal((await call(ownerPrincipal, method, path, body)).status, 404, `orphan task ${method} ${path}`)
  }
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-orphan'))).session ?? null, null)
  // ---- Explicit Start persists waiting_executor and never runs ----
  const started = await call(ownerPrincipal, 'POST', '/tasks/task-alpha/start')
  assert.equal(started.status, 200)
  const startedSession = (await jsonOf(started)).session
  assert.equal(startedSession.status, 'waiting_executor')
  assert.equal(startedSession.executor.connected, false)
  assert.notEqual(startedSession.status, 'running')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/start')).status, 409, 'start is only a draft -> waiting_executor move')
  assert.equal((await jsonOf(await call(ownerPrincipal, 'PUT', '/tasks/task-alpha', planBody))).code, 'SESSION_ACTIVE', 're-planning an active session is refused')
  // ---- The round intake is closed while no executor is connected ----
  const closed = await call(ownerPrincipal, 'POST', '/tasks/task-alpha/rounds', { evidence: [] })
  assert.equal(closed.status, 409)
  assert.equal((await jsonOf(closed)).code, 'EXECUTOR_NOT_CONNECTED')
  // ---- Deterministic engine: dedupe, exponential backoff, terminal stop ----
  const evA = { source: 'example.com', sourceRef: 'r1', summary: '结论 1', confidence: 'high', observedDate: '2026-10-01' }
  const evAKey = await evidenceDedupeKey(evA)
  const deduped = await applyResearchRound(
    { mode: 'continuous', frequency_minutes: 60, max_rounds: 10, cost_limit_usd: 1, cost_spent_usd: 0, no_new_evidence_streak: 0, round_count: 0 },
    [evA, { ...evA }, { source: 'example.com', sourceRef: 'r2', summary: '结论 2' }],
    { now: STAMP },
  )
  assert.equal(deduped.newEvidenceCount, 2, 'identical source+content references dedupe to one row')
  assert.equal(deduped.duplicateEvidenceCount, 1)
  assert.equal(deduped.newEvidence[0].dedupeKey, evAKey)
  const base = { mode: 'continuous', frequency_minutes: 60, max_rounds: 10, cost_limit_usd: 1, cost_spent_usd: 0, no_new_evidence_streak: 0, round_count: 0 }
  const noEvidence1 = await applyResearchRound(base, [], { now: STAMP })
  assert.equal(noEvidence1.noNewEvidenceStreak, 1)
  assert.equal(noEvidence1.nextCheckAt, '2026-10-11T02:00:00.000Z', 'no-new-evidence schedules a doubled backoff')
  const noEvidence2 = await applyResearchRound({ ...base, round_count: 1, no_new_evidence_streak: 1 }, [], { now: STAMP })
  assert.equal(noEvidence2.nextCheckAt, '2026-10-11T04:00:00.000Z')
  const bounded = await applyResearchRound({ ...base, max_rounds: 100, round_count: 20, no_new_evidence_streak: 20 }, [], { now: STAMP })
  assert.equal(bounded.nextCheckAt, '2026-10-12T00:00:00.000Z', 'backoff is bounded by maxBackoffMinutes')
  const withEvidence = await applyResearchRound({ ...base, round_count: 3, no_new_evidence_streak: 4 }, [evA], { now: STAMP })
  assert.equal(withEvidence.noNewEvidenceStreak, 0)
  assert.equal(withEvidence.nextCheckAt, '2026-10-11T01:00:00.000Z', 'fresh evidence returns to the base frequency')
  assert.equal((await applyResearchRound({ ...base, mode: 'once' }, [evA], { now: STAMP })).terminalReason, 'once_mode_completed')
  assert.equal((await applyResearchRound({ ...base, max_rounds: 1 }, [evA], { now: STAMP })).terminalReason, 'max_rounds')
  assert.equal((await applyResearchRound({ ...base, cost_limit_usd: 1, cost_spent_usd: 1 }, [evA], { now: STAMP })).terminalReason, 'budget_exhausted')
  assert.equal((await applyResearchRound(base, [evA], { now: STAMP, goalAchieved: true })).terminalReason, 'goal_achieved')
  // ---- Round intake (fake executor injected) wires the engine end to end ----
  const r1 = await call(ownerPrincipal, 'POST', '/tasks/task-alpha/rounds', { evidence: [evA, { ...evA }], summary: '第 1 轮' }, true)
  assert.equal(r1.status, 201)
  const r1Body = await jsonOf(r1)
  assert.equal(r1Body.round.newEvidenceCount, 1)
  assert.equal(r1Body.round.duplicateEvidenceCount, 1)
  assert.equal(r1Body.session.status, 'waiting_executor')
  assert.equal(r1Body.session.costSpentUsd, 0, 'client-reported spend is never accepted')
  const r2 = await call(ownerPrincipal, 'POST', '/tasks/task-alpha/rounds', {
    evidence: [evA, { source: 'example.com', sourceRef: 'r2', summary: '结论 2' }],
    costSpentUsd: 999,
  }, true)
  const r2Body = await jsonOf(r2)
  assert.equal(r2Body.round.newEvidenceCount, 1)
  assert.equal(r2Body.round.duplicateEvidenceCount, 1)
  assert.equal(r2Body.session.costSpentUsd, 0, 'a client-supplied costSpentUsd must be ignored')
  const afterRounds = await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha'))
  assert.equal(afterRounds.evidence.length, 2)
  assert.equal(afterRounds.rounds.length, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_research_evidence WHERE account_id = ? AND workspace_id = ?').get(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID).n, 2)
  // ---- Pause / resume / cancel are deterministic ----
  assert.equal((await jsonOf(await call(ownerPrincipal, 'POST', '/tasks/task-alpha/pause'))).session.status, 'paused')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/pause')).status, 409, 'pause twice is rejected')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/start')).status, 409, 'start must not turn a paused session back on')
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha'))).session.status, 'paused', 'a rejected start leaves the paused state untouched')
  assert.equal((await jsonOf(await call(ownerPrincipal, 'POST', '/tasks/task-alpha/resume'))).session.status, 'waiting_executor')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/resume')).status, 409, 'resume when not paused is rejected')
  const cancelled = await jsonOf(await call(ownerPrincipal, 'POST', '/tasks/task-alpha/cancel'))
  assert.equal(cancelled.session.status, 'cancelled')
  assert.equal(cancelled.session.terminalReason, 'cancelled')
  assert.equal((await jsonOf(await call(ownerPrincipal, 'POST', '/tasks/task-alpha/cancel'))).session.status, 'cancelled', 'cancel is idempotent')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/start')).status, 409, 'a cancelled session cannot start')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/rounds', { evidence: [] }, true)).status, 409, 'a terminal session takes no rounds')
  // ---- Re-planning is rejected once history exists; nothing is erased ----
  const replanned = await call(ownerPrincipal, 'PUT', '/tasks/task-alpha', { ...planBody, mode: 'once', maxRounds: 1 })
  assert.equal(replanned.status, 409, 'a task with rounds/evidence history cannot be re-planned')
  assert.equal((await jsonOf(replanned)).code, 'SESSION_HAS_HISTORY')
  const preserved = await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha'))
  assert.equal(preserved.rounds.length, 2, 'round history is preserved, never erased')
  assert.equal(preserved.evidence.length, 2, 'evidence history is preserved, never erased')
  assert.equal(preserved.session.status, 'cancelled', 'the cancelled plan is not silently overwritten')
  // ---- Obsidian staging: pending_sync only, no filesystem write ----
  const stagePath = `${OBSIDIAN_DEFAULT_FOLDER}/topic.md`
  const staged = await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', {
    relativePath: stagePath, title: '公开资料核对', body: '用户已确认的增量结论。', citations: ['example.com/r1'],
  })
  assert.equal(staged.status, 201)
  const stagedBody = await jsonOf(staged)
  assert.equal(stagedBody.staged.status, 'pending_sync')
  assert.equal(stagedBody.obsidian.enabled, false)
  assert.equal(stagedBody.obsidian.pendingCount, 1)
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', {
    relativePath: stagePath, title: '公开资料核对', body: '用户已确认的增量结论。', citations: ['example.com/r1'],
  })).status, 200, 'identical staging is idempotent')
  // The outbox listing is task-scoped: there is no workspace-wide status route.
  assert.equal((await call(ownerPrincipal, 'GET', '/obsidian/status')).status, 404, 'the workspace-wide outbox route is removed')
  const status = await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha/obsidian/status'))
  assert.equal(status.taskId, 'task-alpha')
  assert.equal(status.obsidian.enabled, false)
  assert.equal(status.obsidian.configured, false)
  assert.equal(status.obsidian.pendingCount, 1)
  assert.equal(status.outbox.length, 1)
  assert.equal(status.outbox[0].relativePath, stagePath)
  assert.equal((await call(ownerPrincipal, 'GET', '/tasks/task-beta/obsidian/status')).status, 200, 'another task returns only its own (empty) outbox')
  assert.equal((await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-beta/obsidian/status'))).outbox.length, 0, 'a task can never see another task outbox')
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', { relativePath: '../evil.md', title: 't', body: 'b' })).status, 400)
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', { relativePath: '/etc/passwd', title: 't', body: 'b' })).status, 400)
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', { relativePath: 'Other/x.md', title: 't', body: 'b' })).status, 400)
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', { relativePath: `${OBSIDIAN_DEFAULT_FOLDER}/x.txt`, title: 't', body: 'b' })).status, 400)
  assert.equal((await call(ownerPrincipal, 'POST', '/tasks/task-alpha/obsidian', { relativePath: `${OBSIDIAN_DEFAULT_FOLDER}/big.md`, title: 't', body: 'x'.repeat(RESEARCH_EXECUTION_CAPS.maxBlockChars + 1) })).status, 400)
  // ---- Obsidian adapter contract: append-only + base-hash conflict ----
  const adapter = createInMemoryObsidianAdapter({ folder: OBSIDIAN_DEFAULT_FOLDER, files: { [stagePath]: '# 用户手写笔记\n' } })
  const version = await adapter.readVersion(stagePath)
  const block = buildObsidianBlock({ title: '公开资料核对', body: '结论正文', citations: ['example.com/r1'] })
  const applied = await adapter.appendBlock({ relativePath: stagePath, block, expectedBaseHash: version.hash })
  assert.equal(applied.status, 'applied')
  assert.ok(adapter.read(stagePath).startsWith('# 用户手写笔记'), 'the append keeps the user content')
  assert.ok(adapter.read(stagePath).includes('结论正文'))
  const conflicted = await adapter.appendBlock({ relativePath: stagePath, block, expectedBaseHash: version.hash })
  assert.equal(conflicted.status, 'conflict')
  assert.equal(conflicted.reason, 'base_hash_mismatch')
  assert.equal(adapter.read(stagePath).includes(block), true, 'a conflict never overwrites the user edit')
  assert.equal((await adapter.appendBlock({ relativePath: `${OBSIDIAN_DEFAULT_FOLDER}/new.md`, block, expectedBaseHash: null })).status, 'applied', 'a new file appends from an empty base')
  assert.equal((await adapter.appendBlock({ relativePath: 'Other/x.md', block, expectedBaseHash: null })).status, 'rejected')
  assert.equal(normalizeRelativePath('../evil.md', OBSIDIAN_DEFAULT_FOLDER).ok, false)
  assert.equal(normalizeRelativePath('/abs.md', OBSIDIAN_DEFAULT_FOLDER).ok, false)
  assert.equal(normalizeRelativePath(`${OBSIDIAN_DEFAULT_FOLDER}/ok.md`, OBSIDIAN_DEFAULT_FOLDER).ok, true)
  // ---- There is no plan-delete API: history + outbox are never erased ----
  assert.equal((await call(ownerPrincipal, 'DELETE', '/tasks/task-alpha')).status, 404, 'plan deletion is not exposed')
  const afterDeleteAttempt = await jsonOf(await call(ownerPrincipal, 'GET', '/tasks/task-alpha'))
  assert.equal(afterDeleteAttempt.rounds.length, 2, 'rounds survive a rejected delete')
  assert.equal(afterDeleteAttempt.evidence.length, 2, 'evidence survives a rejected delete')
  assert.equal(db.prepare('SELECT goal FROM lifeos_research_sessions WHERE id = ?').get('s-intruder').goal, 'LEAK-INTRUDER')
  assert.equal(db.prepare('SELECT goal FROM lifeos_research_sessions WHERE id = ?').get('s-other-workspace').goal, 'LEAK-OTHER-WS')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_research_evidence WHERE account_id = ? AND workspace_id = ?').get(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID).n, 2, 'scoped evidence is preserved')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_obsidian_sync_outbox WHERE account_id = ? AND workspace_id = ?').get(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID).n, 1, 'the outbox is separate and preserved')
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
  assert.equal(exportKeys.length, 42)
  assert.deepEqual(exportKeys.filter(key => /research|obsidian|round|evidence|outbox/i.test(key)), [])
  const unknownImport = await workbench('/api/personal-workbench/lifeos/data/import', 'POST', { version: '1.1.0', data: { researchSessions: [] } })
  assert.equal(unknownImport.status, 400)
  assert.deepEqual((await jsonOf(unknownImport)).unknown, ['researchSessions'])
  const sessionsBeforeReset = db.prepare('SELECT COUNT(*) AS n FROM lifeos_research_sessions').get().n
  const outboxBeforeReset = db.prepare('SELECT COUNT(*) AS n FROM lifeos_obsidian_sync_outbox').get().n
  assert.equal((await workbench('/api/personal-workbench/lifeos/data/reset', 'DELETE')).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_research_sessions').get().n, sessionsBeforeReset)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_obsidian_sync_outbox').get().n, outboxBeforeReset)
  // ---- View + server wiring contract ----
  const panelSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/research-panel.tsx'), 'utf8')
  const pageSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/tasks-page.tsx'), 'utf8')
  const detailsSource = readFileSync(join(repoRoot, 'src/components/lifeos/tasks/task-detail-extensions.tsx'), 'utf8')
  const serverSource = readFileSync(join(root, 'server.mjs'), 'utf8')
  const moduleSource = readFileSync(join(root, 'src/research.mjs'), 'utf8')
  assert.match(pageSource, /TaskDetailExtensions/, 'selected task detail must mount the shared task extensions')
  assert.match(detailsSource, /ResearchPanel/, 'task detail extensions must mount the research panel')
  assert.match(panelSource, /开始研究/, 'the UI must use an explicit Chinese start button')
  assert.match(panelSource, /等待 Neo\/研究执行器连接/)
  assert.match(panelSource, /sm:grid-cols/, 'panel must keep a responsive layout')
  assert.match(panelSource, /catalog\.sources/, 'the UI must render server-owned source options')
  assert.match(panelSource, /catalog\.actions/, 'the UI must render server-owned action options')
  assert.equal(/type="checkbox"|type="radio"|select/.test(panelSource), true, 'source/action choices must be options, not free text')
  assert.equal(/删除研究|method: 'DELETE'/.test(panelSource), false, 'the UI must not expose a plan-delete control')
  assert.match(moduleSource, /单次/, 'the server catalog must label the once mode in Chinese')
  assert.match(moduleSource, /持续/, 'the server catalog must label the continuous mode in Chinese')
  assert.match(moduleSource, /RESEARCH_SOURCE_OPTIONS/, 'the server must own the source catalog')
  assert.match(moduleSource, /user_provided_reference/)
  assert.match(moduleSource, /stage_obsidian_artifact/, 'the server must own the action catalog')
  assert.equal(/\bfetch\(|https?\.request|node:http|node:https|node:net/i.test(moduleSource), false, 'the research module must make no outbound network call')
  assert.match(panelSource, /\/api\/research\//)
  assert.equal(/api\/agent/.test(panelSource), false, 'the research UI must not call the AI service')
  assert.equal(/DEEPSEEK_API_KEY|OPENAI_API_KEY|apiKey/.test(panelSource), false, 'no provider key may reach the browser')
  assert.match(serverSource, /import \{ handleResearchApi, RESEARCH_API_SUFFIX \} from '\.\/src\/research\.mjs'/)
  assert.match(serverSource, /const researchPrefix = BASE_PATH \+ RESEARCH_API_SUFFIX/)
  assert.match(moduleSource, /resolveLifeOsScope/, 'authority must be reused from the task-card slice')
  assert.equal(/deleteSessionResponse|DELETE FROM lifeos_research_rounds|DELETE FROM lifeos_research_evidence/.test(moduleSource), false, 'the module must never erase research history')
  assert.equal(/obsidian\/status'/.test(serverSource), false)
  assert.equal(/node:fs|from 'fs'|require\('fs'\)|readFileSync|writeFileSync|mkdtempSync/i.test(moduleSource), false, 'the research module must not touch the filesystem')
  assert.equal(/OBSIDIAN_VAULT|VAULT_ROOT|OBSIDIAN_PATH/i.test(serverSource), false, 'no vault path may be configured on the server')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('Research state-machine checks passed: migration rerun, anonymous/B/forged/disabled/revoked denial, orphan-task validation, finite budget + option-catalog caps, draft-only start, no history erasure, task-scoped outbox, dedupe+backoff+terminal engine, closed executor intake, pending-sync staging, adapter conflict contract, unchanged export/reset boundary and view contract.')
} finally {
  db.close()
}
