// Unified-login platform identity: migration idempotency, legacy owner mapping,
// account/workspace/grant authority, session invalidation, export boundary and
// append-only audit. Runs entirely against an in-memory fixture DB (no sockets)
// so it can be executed in constrained environments.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'
import { createPersonalWorkbenchOwnerCredential } from '../src/personal-workbench-auth.mjs'
import {
  LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID, ensurePlatformBootstrap, handlePlatformApi,
  isLegacyOwner, isPlatformAdmin, isSessionTokenRevoked, pruneExpiredTokenRevocations,
  resolvePrincipal, revokeSessionToken, safeReturnTo, syncConfiguredWorkspaces,
} from '../src/platform-auth.mjs'
import {
  hashSessionToken, issueAccountSessionToken, issueSessionToken, verifyAccountSessionToken, verifySessionToken,
} from '../session.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationDir = join(root, 'migrations')
const migrationNames = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()
const migrationSql = name => readFileSync(join(migrationDir, name), 'utf8')

const OWNER = 'heisderek'
const AUTH_SECRET = 'test-only-auth-secret'
const ENTRY_KEY = 'test-only-entry-key'
const B_PASSWORD = 'fixture-b-password-123'
const B_PASSWORD_2 = 'fixture-b-password-456'
const SETUP_KEY = Buffer.alloc(32, 7).toString('base64url')
const SETUP_GRANT = `v2.production.${Math.floor(Date.now() / 1000) + 900}.${SETUP_KEY}`

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec(`CREATE TABLE IF NOT EXISTS lifeos_schema_migrations (
  name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
const markMigration = db.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of migrationNames) {
  db.exec('BEGIN IMMEDIATE')
  try { db.exec(migrationSql(name)); markMigration.run(name); db.exec('COMMIT') }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
// Idempotency: the new platform migration must be safe to rerun on an existing
// DB (the migration runner itself records each filename once).
db.exec(migrationSql('0092_platform_accounts_and_workspaces.sql'))
db.exec(migrationSql('0092_platform_accounts_and_workspaces.sql'))
db.exec(migrationSql('0093_platform_token_revocations.sql'))
db.exec(migrationSql('0093_platform_token_revocations.sql'))
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lifeos_schema_migrations').get().n, migrationNames.length)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_workspaces').get().n, 1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_accounts').get().n, 0)
assert.equal(db.prepare(`SELECT name FROM sqlite_master
  WHERE type = 'table' AND name = 'platform_token_revocations'`).get().name, 'platform_token_revocations')
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_token_revocations').get().n, 0)
assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)

// Existing owner A fixture rows (a slice of the 40-table Life OS data).
db.prepare(`INSERT INTO personal_workbench_lifeos_projects (title,source_id,created_at,updated_at)
  VALUES ('Owner project','owner-project-1','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run()
db.prepare(`INSERT INTO personal_workbench_lifeos_tasks (title,status,priority,archived,created_at,updated_at)
  VALUES ('Owner task','todo','medium',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run()
db.prepare(`INSERT INTO lifeos_workspaces (id,name,is_default,layout,sort_order,created_at,updated_at)
  VALUES ('ws-owner-1','Default',1,'{}',0,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z')`).run()
const fixtureSnapshot = () => JSON.stringify({
  projects: db.prepare('SELECT * FROM personal_workbench_lifeos_projects ORDER BY id').all(),
  tasks: db.prepare('SELECT * FROM personal_workbench_lifeos_tasks ORDER BY id').all(),
  workspaces: db.prepare('SELECT * FROM lifeos_workspaces ORDER BY id').all(),
})
const fixturesBefore = fixtureSnapshot()

const env = {
  DB: createD1Sqlite(db),
  AUTH_SECRET,
  PERSONAL_WORKBENCH_ENTRY_KEY: ENTRY_KEY,
  PERSONAL_WORKBENCH_OWNER: OWNER,
  PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED: 'true',
  PERSONAL_WORKBENCH_OWNER_SETUP_GRANT: SETUP_GRANT,
  ENVIRONMENT: 'production',
  PLATFORM_WORKSPACES_JSON: JSON.stringify([
    { id: 'ws_ops_meta', slug: 'ops', displayName: '运营工作区', configured: false },
    { id: 'ws_ops_ready', slug: 'ops-ready', displayName: 'Ready Ops', configured: true, applicationTarget: '/ops/' },
  ]),
}
await ensurePlatformBootstrap(env)
await ensurePlatformBootstrap(env)
await syncConfiguredWorkspaces(env)

const owner = db.prepare('SELECT * FROM platform_accounts WHERE account_id = ?').get(LEGACY_ACCOUNT_ID)
assert.equal(owner.username, OWNER)
assert.equal(owner.role, 'platform_admin')
assert.equal(Number(owner.legacy_owner), 1)
assert.equal(Number(owner.enabled), 1)
assert.equal(Number(owner.session_version), 1)
assert.equal(owner.password_hash, null)
assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM platform_account_workspaces
  WHERE account_id = ? AND workspace_id = ?`).get(LEGACY_ACCOUNT_ID, LEGACY_WORKSPACE_ID).n, 1)

// Secure formal credential entry for A (setup grant), then unified login.
const credentialResponse = await createPersonalWorkbenchOwnerCredential(new Request(
  'https://lifeos.test/api/personal-workbench/owner-credential',
  {
    method: 'POST',
    headers: { origin: 'https://lifeos.test', 'content-type': 'application/json' },
    body: JSON.stringify({ setupKey: SETUP_KEY, password: 'fixture-owner-password', confirmPassword: 'fixture-owner-password' }),
  },
), env)
assert.equal(credentialResponse.status, 204)

function api(path, { method = 'GET', body, principal = null, token = '' } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.cookie = `happyspa_personal_workbench=${token}`
  const request = new Request(`https://lifeos.test${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return handlePlatformApi(request, env, new URL(request.url), principal)
}
async function login(username, password, extra = {}) {
  const response = await api('/api/platform/login', { method: 'POST', body: { username, password, ...extra } })
  const cookie = response.headers.get('set-cookie') || ''
  const token = /happyspa_personal_workbench=([^;]+)/.exec(cookie)?.[1] || ''
  return { response, token }
}

assert.equal((await login(OWNER, 'wrong-password-value')).response.status, 401)
const ownerLogin = await login(OWNER, 'fixture-owner-password')
assert.equal(ownerLogin.response.status, 200)
assert.match(ownerLogin.response.headers.get('set-cookie') || '', /HttpOnly; Secure; SameSite=Strict/)
assert.match(ownerLogin.response.headers.get('set-cookie') || '', /Max-Age=28800/)
const ownerPrincipal = await resolvePrincipal(env, ownerLogin.token)
assert.equal(ownerPrincipal.role, 'platform_admin')
assert.equal(ownerPrincipal.accountId, LEGACY_ACCOUNT_ID)
assert.equal(isPlatformAdmin(ownerPrincipal), true)
assert.equal(isLegacyOwner(ownerPrincipal), true)
// Account sessions and legacy entry-key sessions are mutually exclusive.
assert.equal(verifySessionToken(ownerLogin.token, AUTH_SECRET, ENTRY_KEY), null)
assert.equal(await resolvePrincipal(env, `${ownerLogin.token}x`), null)
assert.equal(await resolvePrincipal(env, issueAccountSessionToken('other-secret', LEGACY_ACCOUNT_ID, 1)), null)

const legacyToken = issueSessionToken(AUTH_SECRET, ENTRY_KEY, OWNER)
const legacyPrincipal = await resolvePrincipal(env, legacyToken)
assert.equal(legacyPrincipal.type, 'legacy-entry')
assert.equal(legacyPrincipal.role, 'legacy-owner')
assert.equal(isLegacyOwner(legacyPrincipal), true)
assert.equal(isPlatformAdmin(legacyPrincipal), false)
assert.equal(verifyAccountSessionToken(legacyToken, AUTH_SECRET), null)

// Admin creates regular accounts only.
const createB = await api('/api/platform/admin/accounts', {
  method: 'POST', body: { username: 'member-b', displayName: '成员 B' }, principal: ownerPrincipal,
})
assert.equal(createB.status, 201)
const createdB = await createB.json()
const bId = createdB.account.accountId
assert.match(bId, /^acct_[0-9a-f]{32}$/)
assert.notEqual(bId, 'member-b')
assert.equal(createdB.account.role, 'member')
assert.equal(createdB.account.legacyOwner, false)
assert.equal(Object.hasOwn(createdB.account, 'password_hash'), false)
assert.equal((await api('/api/platform/admin/accounts', {
  method: 'POST', body: { username: 'wannabe-admin', role: 'platform_admin' }, principal: ownerPrincipal,
})).status, 400)
assert.equal((await api('/api/platform/admin/accounts', {
  method: 'POST', body: { username: 'Bad Name' }, principal: ownerPrincipal,
})).status, 400)

// B cannot log in until A sets a password.
assert.equal((await login('member-b', B_PASSWORD)).response.status, 401)
const setPassword = await api(`/api/platform/admin/accounts/${bId}/password`, {
  method: 'POST', body: { password: B_PASSWORD }, principal: ownerPrincipal,
})
assert.equal(setPassword.status, 204)
assert.equal(db.prepare('SELECT length(password_hash) AS n FROM platform_accounts WHERE account_id = ?').get(bId).n, 64)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), 2)

// Fake role/account/workspace claims in the login body are ignored.
const bLogin = await login('member-b', B_PASSWORD,
  { role: 'platform_admin', legacyOwner: true, workspaceId: LEGACY_WORKSPACE_ID })
assert.equal(bLogin.response.status, 200)
const bPrincipal = await resolvePrincipal(env, bLogin.token)
assert.equal(bPrincipal.role, 'member')
assert.equal(bPrincipal.legacyOwner, false)
assert.equal(isPlatformAdmin(bPrincipal), false)
assert.equal(isLegacyOwner(bPrincipal), false)

assert.deepEqual((await (await api('/api/platform/workspaces', { principal: bPrincipal })).json()).workspaces, [])
assert.equal((await api('/api/platform/admin/accounts', { principal: bPrincipal })).status, 403)
assert.equal((await api('/api/platform/admin/accounts', { principal: legacyPrincipal })).status, 403)
assert.equal((await api('/api/platform/admin/accounts', {})).status, 401)
assert.equal((await api('/api/platform/session', { principal: null })).status, 401)

// Grants: a new grant is immediately visible to B's already-valid session
// without bumping session_version; the follow-up is a no-op.
const bVersionBeforeGrant = Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v)
assert.equal(await (await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_meta', granted: true }, principal: ownerPrincipal,
})).json().then(body => body.changed), true)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), bVersionBeforeGrant)
const bPrincipalAfterGrant = await resolvePrincipal(env, bLogin.token)
assert.ok(bPrincipalAfterGrant)
assert.deepEqual((await (await api('/api/platform/workspaces', { principal: bPrincipalAfterGrant })).json())
  .workspaces.map(ws => ws.workspaceId), ['ws_ops_meta'])
assert.equal(await (await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_meta', granted: true }, principal: ownerPrincipal,
})).json().then(body => body.changed), false)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), bVersionBeforeGrant)
const bWorkspaces = await (await api('/api/platform/workspaces', { principal: bPrincipalAfterGrant })).json()
assert.deepEqual(bWorkspaces.workspaces.map(ws => ws.workspaceId), ['ws_ops_meta'])
assert.equal(bWorkspaces.workspaces[0].configured, false)
assert.equal((await api(`/api/platform/workspaces/${LEGACY_WORKSPACE_ID}`, { principal: bPrincipal })).status, 404)
assert.equal((await (await api('/api/platform/workspaces/ws_ops_meta', { principal: bPrincipal })).json()).status, 'not_configured')
assert.equal((await api('/api/platform/workspaces/ws_ops_ready', { principal: bPrincipal })).status, 404)
await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_ready', granted: true }, principal: ownerPrincipal,
})
const readyLanding = await (await api('/api/platform/workspaces/ws_ops_ready', { principal: bPrincipal })).json()
assert.equal(readyLanding.status, 'configured')
assert.equal(readyLanding.applicationTarget, '/ops/')
// The legacy Life OS workspace can never be granted to a regular account.
assert.equal((await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: LEGACY_WORKSPACE_ID, granted: true }, principal: ownerPrincipal,
})).status, 409)

// Disable invalidates the existing session immediately; re-enable restores login.
const bVersionBeforeToggle = Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v)
assert.equal((await api(`/api/platform/admin/accounts/${bId}/enabled`, {
  method: 'POST', body: { enabled: false }, principal: ownerPrincipal,
})).status, 204)
assert.equal(await resolvePrincipal(env, bLogin.token), null)
assert.equal((await api('/api/platform/session', { principal: await resolvePrincipal(env, bLogin.token) })).status, 401)
assert.equal((await login('member-b', B_PASSWORD)).response.status, 401)
assert.equal((await api(`/api/platform/admin/accounts/${bId}/enabled`, {
  method: 'POST', body: { enabled: true }, principal: ownerPrincipal,
})).status, 204)
const bVersionAfterToggle = Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v)
// Both disable and re-enable bump session_version, so the original token stays
// dead even after re-enable (disable/re-enable cannot revive it).
assert.equal(bVersionAfterToggle, bVersionBeforeToggle + 2)
assert.equal(await resolvePrincipal(env, bLogin.token), null)
assert.equal((await api('/api/platform/session', { principal: await resolvePrincipal(env, bLogin.token) })).status, 401)
// A no-op enabled state change keeps the value (and existing sessions) intact.
assert.equal((await api(`/api/platform/admin/accounts/${bId}/enabled`, {
  method: 'POST', body: { enabled: true }, principal: ownerPrincipal,
})).status, 204)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), bVersionAfterToggle)
const bLogin2 = await login('member-b', B_PASSWORD)
const bPrincipal2 = await resolvePrincipal(env, bLogin2.token)
assert.equal(bLogin2.response.status, 200)

// Revoke removes the workspace immediately, invalidates the live session, and a
// later regrant cannot revive that old token.
const bVersionBeforeRevoke = bVersionAfterToggle
assert.equal(await (await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_ready', granted: false }, principal: ownerPrincipal,
})).json().then(body => body.changed), true)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), bVersionBeforeRevoke + 1)
// The revoked B token fails to resolve immediately and every protected path is
// denied.
assert.equal(await resolvePrincipal(env, bLogin2.token), null)
assert.equal((await api('/api/platform/session', { principal: await resolvePrincipal(env, bLogin2.token) })).status, 401)
assert.equal((await api('/api/platform/workspaces', { principal: await resolvePrincipal(env, bLogin2.token) })).status, 401)
// Re-grant ws_ops_ready (idempotent follow-up): the grant is effective, but the
// revoked token stays dead.
assert.equal(await (await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_ready', granted: true }, principal: ownerPrincipal,
})).json().then(body => body.changed), true)
// The regrant does not bump session_version, so it can never revive the revoked token.
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(bId).v), bVersionBeforeRevoke + 1)
assert.equal(await resolvePrincipal(env, bLogin2.token), null)
const bLogin4 = await login('member-b', B_PASSWORD)
assert.equal(bLogin4.response.status, 200)
const bPrincipal4 = await resolvePrincipal(env, bLogin4.token)
assert.deepEqual((await (await api('/api/platform/workspaces', { principal: bPrincipal4 })).json())
  .workspaces.map(ws => ws.workspaceId).sort(), ['ws_ops_meta', 'ws_ops_ready'])
assert.equal((await api('/api/platform/workspaces/ws_ops_ready', { principal: bPrincipal4 })).status, 200)
// Re-revoking through the fresh session is immediate again.
assert.equal(await (await api(`/api/platform/admin/accounts/${bId}/workspaces`, {
  method: 'POST', body: { workspaceId: 'ws_ops_ready', granted: false }, principal: ownerPrincipal,
})).json().then(body => body.changed), true)
assert.equal(await resolvePrincipal(env, bLogin4.token), null)
assert.deepEqual((await (await api('/api/platform/workspaces', { principal: bPrincipal2 })).json())
  .workspaces.map(ws => ws.workspaceId), ['ws_ops_meta'])
assert.equal((await api('/api/platform/workspaces/ws_ops_ready', { principal: bPrincipal2 })).status, 404)

// Self-lockout and admin-promotion protections.
assert.equal((await api(`/api/platform/admin/accounts/${LEGACY_ACCOUNT_ID}/enabled`, {
  method: 'POST', body: { enabled: false }, principal: ownerPrincipal,
})).status, 409)
assert.equal((await api(`/api/platform/admin/accounts/${LEGACY_ACCOUNT_ID}/password`, {
  method: 'POST', body: { password: 'fixture-owner-password' }, principal: ownerPrincipal,
})).status, 409)

// Password change bumps session_version and invalidates the previous session.
const bLogin3 = await login('member-b', B_PASSWORD)
assert.ok(await resolvePrincipal(env, bLogin3.token))
assert.equal((await api(`/api/platform/admin/accounts/${bId}/password`, {
  method: 'POST', body: { password: B_PASSWORD_2 }, principal: ownerPrincipal,
})).status, 204)
assert.equal(await resolvePrincipal(env, bLogin3.token), null)
assert.equal((await login('member-b', B_PASSWORD)).response.status, 401)
assert.equal((await login('member-b', B_PASSWORD_2)).response.status, 200)

// ---- Server-side durable per-token revocation ----

// Two live account sessions for the same account stay isolated: logging one out
// leaves the other valid, and logout never bumps session_version.
const sessionOne = await login(OWNER, 'fixture-owner-password')
const sessionTwo = await login(OWNER, 'fixture-owner-password')
assert.ok(await resolvePrincipal(env, sessionOne.token))
assert.ok(await resolvePrincipal(env, sessionTwo.token))
const ownerVersionBeforeLogout = Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(LEGACY_ACCOUNT_ID).v)
const logoutOne = await api('/api/platform/logout', { method: 'POST', token: sessionOne.token })
assert.equal(logoutOne.status, 204)
assert.match(logoutOne.headers.get('set-cookie') || '', /Max-Age=0/)
assert.equal(await isSessionTokenRevoked(env, sessionOne.token), true)
assert.equal(await resolvePrincipal(env, sessionOne.token), null)
assert.equal((await api('/api/platform/session', { token: sessionOne.token, principal: await resolvePrincipal(env, sessionOne.token) })).status, 401)
assert.ok(await resolvePrincipal(env, sessionTwo.token))
assert.equal((await api('/api/platform/session', { token: sessionTwo.token, principal: await resolvePrincipal(env, sessionTwo.token) })).status, 200)
assert.equal(Number(db.prepare('SELECT session_version AS v FROM platform_accounts WHERE account_id = ?').get(LEGACY_ACCOUNT_ID).v), ownerVersionBeforeLogout)

// DELETE /api/platform/session revokes the presented token just like logout.
const sessionDel = await login(OWNER, 'fixture-owner-password')
assert.equal((await api('/api/platform/session', { method: 'DELETE', token: sessionDel.token })).status, 204)
assert.equal(await isSessionTokenRevoked(env, sessionDel.token), true)
assert.equal(await resolvePrincipal(env, sessionDel.token), null)

// Malformed/forged tokens never create a revocation row and never block a valid token.
const forgedToken = `${sessionTwo.token.split('.')[0]}.forged-signature`
assert.equal((await api('/api/platform/logout', { method: 'POST', token: forgedToken })).status, 204)
assert.equal(await isSessionTokenRevoked(env, forgedToken), false)
assert.ok(await resolvePrincipal(env, sessionTwo.token))

// Logout rejects the exact newly-issued legacy entry-key token.
const freshLegacy = issueSessionToken(AUTH_SECRET, ENTRY_KEY, OWNER)
assert.equal((await resolvePrincipal(env, freshLegacy)).type, 'legacy-entry')
assert.equal((await api('/api/platform/logout', { method: 'POST', token: freshLegacy })).status, 204)
assert.equal(await isSessionTokenRevoked(env, freshLegacy), true)
assert.equal(await resolvePrincipal(env, freshLegacy), null)

// A genuine pre-migration legacy token with no `type` claim (old shape) is
// accepted before logout and rejected after, with type/account recorded.
const entryKeyVersion = createHash('sha256').update(ENTRY_KEY).digest('hex')
function signLegacyClaims(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')}`
}
const legacyNow = Date.now()
const oldFormatLegacy = signLegacyClaims({
  role: 'personal-workbench', scope: 'personal-workbench', username: OWNER,
  exp: Math.floor(legacyNow / 86400000), personalWorkbenchExpiresAt: legacyNow + 8 * 60 * 60 * 1000,
  personalWorkbenchKeyVersion: entryKeyVersion,
})
assert.equal(Object.hasOwn(JSON.parse(Buffer.from(oldFormatLegacy.split('.')[0], 'base64url').toString('utf8')), 'type'), false)
assert.equal((await resolvePrincipal(env, oldFormatLegacy)).type, 'legacy-entry')
assert.equal(await isSessionTokenRevoked(env, oldFormatLegacy), false)
assert.equal((await api('/api/platform/logout', { method: 'POST', token: oldFormatLegacy })).status, 204)
assert.equal(await isSessionTokenRevoked(env, oldFormatLegacy), true)
assert.equal(await resolvePrincipal(env, oldFormatLegacy), null)
const oldFormatRow = db.prepare('SELECT token_type, account_id FROM platform_token_revocations WHERE token_hash = ?')
  .get(hashSessionToken(oldFormatLegacy))
assert.equal(oldFormatRow.token_type, 'legacy-entry')
assert.equal(oldFormatRow.account_id, LEGACY_ACCOUNT_ID)

// Old key-version invalidation is preserved after rotation.
const rotatedKeyLegacy = issueSessionToken(AUTH_SECRET, 'rotated-away-entry-key', OWNER)
assert.equal(verifySessionToken(rotatedKeyLegacy, AUTH_SECRET, ENTRY_KEY), null)
assert.equal(await resolvePrincipal(env, rotatedKeyLegacy), null)

// A token already invalidated by session_version can still be individually
// blacklisted (valid signature, stale session version).
const bStale = await login('member-b', B_PASSWORD_2)
assert.ok(await resolvePrincipal(env, bStale.token))
assert.equal((await api(`/api/platform/admin/accounts/${bId}/enabled`, {
  method: 'POST', body: { enabled: false }, principal: ownerPrincipal,
})).status, 204)
assert.equal(await resolvePrincipal(env, bStale.token), null)
assert.equal((await api('/api/platform/logout', { method: 'POST', token: bStale.token })).status, 204)
assert.equal(await isSessionTokenRevoked(env, bStale.token), true)
assert.equal((await api(`/api/platform/admin/accounts/${bId}/enabled`, {
  method: 'POST', body: { enabled: true }, principal: ownerPrincipal,
})).status, 204)

// Pruning removes only rows whose token is already past its own expiry, so an
// unexpired token can never bypass its revocation.
const liveRevoked = await login(OWNER, 'fixture-owner-password')
await revokeSessionToken(env, liveRevoked.token)
const liveHash = hashSessionToken(liveRevoked.token)
assert.ok(db.prepare('SELECT expires_at FROM platform_token_revocations WHERE token_hash = ?').get(liveHash))
await pruneExpiredTokenRevocations(env)
assert.ok(db.prepare('SELECT 1 AS ok FROM platform_token_revocations WHERE token_hash = ?').get(liveHash))
assert.equal(await resolvePrincipal(env, liveRevoked.token), null)
const expiredHash = 'f'.repeat(64)
db.prepare(`INSERT INTO platform_token_revocations (token_hash, token_type, account_id, revoked_at, expires_at)
  VALUES (?, 'account', NULL, ?, ?)`).run(expiredHash,
  new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 60_000).toISOString())
await pruneExpiredTokenRevocations(env)
assert.equal(Boolean(db.prepare('SELECT 1 AS ok FROM platform_token_revocations WHERE token_hash = ?').get(expiredHash)), false)

// Only SHA-256 digests are stored; the raw tokens and credentials never appear.
const revocationDump = JSON.stringify(db.prepare('SELECT * FROM platform_token_revocations').all())
for (const raw of [sessionOne.token, sessionTwo.token, sessionDel.token, freshLegacy, oldFormatLegacy, liveRevoked.token]) {
  assert.equal(revocationDump.includes(raw), false)
}
assert.equal(revocationDump.includes('fixture-owner-password'), false)

// Account listings never expose credential material.
const accountList = await (await api('/api/platform/admin/accounts', { principal: ownerPrincipal })).json()
assert.equal(accountList.accounts.length, 2)
assert.equal(JSON.stringify(accountList).includes('password'), false)

// Append-only audit: no password material, and update/delete are refused.
const auditDump = JSON.stringify(db.prepare('SELECT * FROM platform_auth_audit').all())
assert.equal(auditDump.includes(B_PASSWORD), false)
assert.equal(auditDump.includes(B_PASSWORD_2), false)
assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM platform_auth_audit WHERE action = 'login.succeeded'`).get().n >= 1)
assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM platform_auth_audit WHERE action = 'workspace.granted'`).get().n >= 1)
assert.throws(() => db.prepare(`UPDATE platform_auth_audit SET action = 'tampered'`).run(), /append-only/)
assert.throws(() => db.prepare('DELETE FROM platform_auth_audit').run(), /append-only/)

// Open-redirect hardening: only known local workspace paths are accepted.
assert.equal(safeReturnTo('/workbench/'), '/workbench/')
assert.equal(safeReturnTo('/workspaces/'), '/workspaces/')
assert.equal(safeReturnTo('/workspace/ops'), '/workspace/ops')
assert.equal(safeReturnTo('https://attacker.example/'), null)
assert.equal(safeReturnTo('//attacker.example/'), null)
assert.equal(safeReturnTo('/workbench/../admin'), null)
assert.equal(safeReturnTo('javascript:alert(1)'), null)

// A's pre-existing Life OS fixture rows survive migration and auth/admin ops.
assert.equal(fixtureSnapshot(), fixturesBefore)

// Export/import/reset boundary: the 40-collection contract never touches auth.
const legacyAuth = { role: 'personal-workbench', scope: 'personal-workbench', username: OWNER }
async function workbench(path, method = 'GET', body) {
  const request = new Request(`https://lifeos.test${path}`, {
    method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return handlePersonalWorkbench(request, env, new URL(request.url), legacyAuth)
}
const exportResponse = await workbench('/api/personal-workbench/lifeos/data/export')
assert.equal(exportResponse.status, 200)
const exported = await exportResponse.json()
assert.equal(Object.keys(exported.data).length, 40)
assert.equal(Object.keys(exported.data).every(key => !key.startsWith('platform')), true)
assert.equal(Object.hasOwn(exported.data, 'accounts'), false)
assert.equal(Object.hasOwn(exported.data, 'accountWorkspaces'), false)
assert.equal(Object.hasOwn(exported.data, 'authAudit'), false)
assert.equal(Object.hasOwn(exported.data, 'tokenRevocations'), false)
assert.equal(exported.data.projects.length, 1)

const platformCounts = () => JSON.stringify({
  accounts: db.prepare('SELECT COUNT(*) AS n FROM platform_accounts').get().n,
  workspaces: db.prepare('SELECT COUNT(*) AS n FROM platform_workspaces').get().n,
  grants: db.prepare('SELECT COUNT(*) AS n FROM platform_account_workspaces').get().n,
  audit: db.prepare('SELECT COUNT(*) AS n FROM platform_auth_audit').get().n,
  revocations: db.prepare('SELECT COUNT(*) AS n FROM platform_token_revocations').get().n,
})
const platformBefore = platformCounts()
assert.equal((await workbench('/api/personal-workbench/lifeos/data/reset', 'DELETE')).status, 200)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_workbench_lifeos_projects').get().n, 0)
assert.equal(platformCounts(), platformBefore)
const importResponse = await workbench('/api/personal-workbench/lifeos/data/import', 'POST', exported)
assert.equal(importResponse.status, 200)
assert.equal((await importResponse.json()).imported.projects, 1)
assert.equal(platformCounts(), platformBefore)

// Legacy owner retains Life OS access; a non-owner principal is denied at the
// module boundary and never reaches any private handler.
assert.equal((await workbench('/api/personal-workbench/lifeos/data/export')).status, 200)
const nonOwner = { role: 'member', scope: 'personal-workbench', username: 'member-b' }
const denied = await handlePersonalWorkbench(
  new Request('https://lifeos.test/api/personal-workbench/projects'),
  env, new URL('https://lifeos.test/api/personal-workbench/projects'), nonOwner)
assert.equal(denied.status, 404)

assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
console.log('Platform migration idempotency, legacy owner mapping, account/workspace/grant authority, session invalidation, export boundary, append-only audit and rollback-safe rerun checks passed.')
db.close()
