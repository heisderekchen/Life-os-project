// Server-boundary acceptance for the unified login + platform-admin workbench.
// Requires loopback sockets, so it runs in CI (like test-http.mjs).
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { createServer } from 'node:net'
import { request as httpRequest, createServer as createHttpServer } from 'node:http'
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
const temp = mkdtempSync(join(tmpdir(), 'lifeos-platform-http-'))
const nextDir = join(temp, 'next')
mkdirSync(nextDir)
writeFileSync(join(nextDir, 'server.js'),
  `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('mock next '+req.url)}).listen(Number(process.env.PORT),'127.0.0.1')`)

const agent = createHttpServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(req.url === '/v1/health'
    ? { status: 'ok', taskTrigger: 'approved_worker', providers: { deepseek: true, openai: false } }
    : { ok: true }))
})
await new Promise(resolve => agent.listen(0, '127.0.0.1', resolve))
const agentPort = agent.address().port

const port = await freePort()
const nextPort = await freePort()
const origin = `https://127.0.0.1:${port}`
const setupKey = Buffer.alloc(32, 9).toString('base64url')
const setupGrant = `v2.production.${Math.floor(Date.now() / 1000) + 1200}.${setupKey}`
const ownerName = 'lifeos-owner'
const ownerPassword = 'fixture-owner-password'
const bPassword = 'fixture-b-password-123'

const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: temp,
  env: {
    ...process.env,
    DATABASE_URL: `file:${join(temp, 'lifeos.db')}`,
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
    AGENT_SERVICE_URL: `http://127.0.0.1:${agentPort}`,
    AGENT_SERVICE_TOKEN: 'test-service-token',
    WORKSPACE_SUBJECT_SIGNING_SECRET: 'test-signing-secret',
  },
  stdio: 'ignore',
})

const base = `http://127.0.0.1:${port}`
const proxyHeaders = { 'x-forwarded-proto': 'https' }
const jsonHeaders = { ...proxyHeaders, origin, 'content-type': 'application/json' }

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`)
    try { if ((await fetch(`${base}/internal/health`)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('server did not become healthy')
}

function rawRequest(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

const cookieOf = response => (response.headers.get('set-cookie') || '').split(';', 1)[0]

try {
  await waitReady()

  // Login shell: responsive, account-based, no self-signup affordance.
  const loginPage = await fetch(`${base}/`)
  assert.equal(loginPage.status, 200)
  const loginHtml = await loginPage.text()
  assert.match(loginHtml, /统一登录/)
  assert.match(loginHtml, /私人 Life OS/)
  assert.match(loginHtml, /<meta name="viewport" content="width=device-width,initial-scale=1">/)
  assert.ok(loginHtml.includes('.box{box-sizing:border-box;width:min(360px,calc(100% - 40px))'))
  assert.match(loginHtml, /id="username"/)
  assert.match(loginHtml, /type="password"/)
  assert.equal(/注册|signup|sign-up|register/i.test(loginHtml), false)
  assert.match(await (await fetch(`${base}/workbench/`)).text(), /统一登录/)

  // Anonymous: no private Life OS surface, no platform authority.
  for (const path of ['/workbench/api/app-state', '/workbench/api/tasks', '/workbench/api/projects',
    '/api/personal-workbench/projects', '/api/personal-workbench/lifeos/data/export',
    '/api/personal-workbench/lifeos/search?q=private', '/workbench/api/agent/health']) {
    assert.equal((await fetch(`${base}${path}`, { headers: proxyHeaders })).status, 404, `anonymous ${path}`)
  }
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: proxyHeaders })).status, 401)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts`, { headers: proxyHeaders })).status, 401)

  // Cross-origin / untrusted-proxy / wrong-content-type login attempts fail.
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: { ...proxyHeaders, origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: { ...proxyHeaders, origin, 'content-type': 'text/plain' },
    body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })).status, 415)
  const hostSpoof = await rawRequest('/api/platform/login', {
    method: 'POST',
    headers: { host: 'attacker.example', origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
    body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })
  assert.equal(hostSpoof.status, 404)

  // Owner credential setup, then legacy entry-key login for A.
  assert.equal((await fetch(`${base}/api/personal-workbench/owner-credential`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ setupKey, password: ownerPassword, confirmPassword: ownerPassword }),
  })).status, 204)
  const entry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ key: 'test-only-entry-key' }),
  })
  assert.equal(entry.status, 204)
  const entryCookie = entry.headers.get('set-cookie') || ''
  assert.match(entryCookie, /HttpOnly; Secure; SameSite=Strict/)
  const entryHeaders = { ...jsonHeaders, cookie: cookieOf(entry) }
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: { ...proxyHeaders, cookie: cookieOf(entry) } })).status, 200)
  assert.equal((await fetch(`${base}/workbench/api/agent/health`, { headers: { ...proxyHeaders, cookie: cookieOf(entry) } })).status, 200)

  // Legacy entry-key session has no platform-admin authority.
  assert.equal((await fetch(`${base}/api/platform/admin/accounts`, { headers: { ...proxyHeaders, cookie: cookieOf(entry) } })).status, 403)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts`, {
    method: 'POST', headers: entryHeaders, body: JSON.stringify({ username: 'blocked-by-entry-key' }),
  })).status, 403)
  const legacySession = await (await fetch(`${base}/api/platform/session`,
    { headers: { ...proxyHeaders, cookie: cookieOf(entry) } })).json()
  assert.equal(legacySession.principal.sessionType, 'legacy-entry')

  // Unified account login for A.
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: ownerName, password: 'wrong-password-value' }),
  })).status, 401)
  const ownerLogin = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: ownerName, password: ownerPassword, returnTo: 'https://attacker.example/' }),
  })
  assert.equal(ownerLogin.status, 200)
  const ownerLoginBody = await ownerLogin.json()
  assert.equal(ownerLoginBody.account.role, 'platform_admin')
  assert.equal(ownerLoginBody.returnTo, null)
  const ownerCookie = cookieOf(ownerLogin)
  const ownerHeaders = { ...jsonHeaders, cookie: ownerCookie }
  assert.match(ownerLogin.headers.get('set-cookie') || '', /HttpOnly; Secure; SameSite=Strict/)
  const returnToWorkbench = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: ownerName, password: ownerPassword, returnTo: '/workbench/' }),
  })
  assert.equal((await returnToWorkbench.json()).returnTo, '/workbench/')
  // A retains all existing Life OS access.
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: { ...proxyHeaders, cookie: ownerCookie } })).status, 200)
  assert.equal((await fetch(`${base}/workbench/`, { headers: { ...proxyHeaders, cookie: ownerCookie } })).status, 200)
  assert.equal((await fetch(`${base}/workbench/api/agent/health`, { headers: { ...proxyHeaders, cookie: ownerCookie } })).status, 200)

  // Admin creates B, rejects promotion, sets B's password.
  const createB = await fetch(`${base}/api/platform/admin/accounts`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ username: 'member-b', displayName: '成员 B' }),
  })
  assert.equal(createB.status, 201)
  const bId = (await createB.json()).account.accountId
  assert.equal((await fetch(`${base}/api/platform/admin/accounts`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ username: 'wannabe', role: 'platform_admin' }),
  })).status, 400)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/password`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ password: bPassword }),
  })).status, 204)

  // B logs in and sees only granted workspace metadata.
  const bLogin = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'member-b', password: bPassword, role: 'platform_admin', workspaceId: 'ws_lifeos_legacy' }),
  })
  assert.equal(bLogin.status, 200)
  assert.equal((await bLogin.clone().json()).account.role, 'member')
  const bCookie = cookieOf(bLogin)
  const bHeaders = { ...proxyHeaders, cookie: bCookie }
  const bSession = await (await fetch(`${base}/api/platform/session`, { headers: bHeaders })).json()
  assert.equal(bSession.principal.role, 'member')
  assert.deepEqual((await fetch(`${base}/api/platform/workspaces`, { headers: bHeaders }).then(r => r.json())).workspaces, [])
  assert.equal((await fetch(`${base}/api/platform/admin/accounts`, { headers: bHeaders })).status, 403)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: { ...bHeaders, origin, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
  })).status, 403)

  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/workspaces`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ workspaceId: 'ws_ops_meta', granted: true }),
  })).status, 200)
  const bWorkspaceList = await fetch(`${base}/api/platform/workspaces`, { headers: bHeaders }).then(r => r.json())
  assert.deepEqual(bWorkspaceList.workspaces.map(ws => ws.workspaceId), ['ws_ops_meta'])
  assert.equal(bWorkspaceList.workspaces[0].configured, false)
  assert.equal(bWorkspaceList.catalog, undefined)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/workspaces`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ workspaceId: 'ws_lifeos_legacy', granted: true }),
  })).status, 409)

  // B is denied every existing private Life OS prefix/alias and A IDOR attempt.
  const deniedPaths = [
    ['GET', '/workbench/api/app-state'], ['GET', '/workbench/api/tasks'],
    ['POST', '/workbench/api/projects'], ['GET', '/workbench/api/projects'],
    ['GET', '/api/personal-workbench/projects'], ['GET', '/api/personal-workbench/projects/1'],
    ['GET', '/api/personal-workbench/lifeos/data/export'], ['GET', '/api/personal-workbench/lifeos/search?q=private'],
    ['GET', '/api/personal-workbench/lifeos/app-state'], ['DELETE', '/api/personal-workbench/lifeos/data/reset'],
    ['POST', '/api/personal-workbench/lifeos/data/import'], ['GET', '/workbench/api/agent/health'],
    ['POST', '/workbench/api/agent/runs'], ['GET', '/workbench/api/insights'], ['GET', '/workbench/api/analytics'],
  ]
  for (const [method, path] of deniedPaths) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...bHeaders, origin, 'content-type': 'application/json',
        'x-workspace-subject': 'lifeos-owner', 'x-platform-role': 'platform_admin' },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ title: 'idor' }) }),
    })
    assert.equal(response.status, 404, `B ${method} ${path}`)
  }
  assert.equal((await fetch(`${base}/workbench/`, { headers: bHeaders })).status, 404)
  assert.equal((await fetch(`${base}/workbench`, { headers: bHeaders, redirect: 'manual' })).status, 404)

  // B workspace landing pages render a safe not-configured state; ungranted is
  // a generic not-found.
  const list = await fetch(`${base}/workspaces/`, { headers: bHeaders })
  assert.equal(list.status, 200)
  assert.match(await list.text(), /运营工作区/)
  const notConfigured = await fetch(`${base}/workspace/ops`, { headers: bHeaders })
  assert.equal(notConfigured.status, 200)
  assert.match(await notConfigured.text(), /尚未配置/)
  assert.equal((await fetch(`${base}/workspace/lifeos`, { headers: bHeaders })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/workspaces/ws_lifeos_legacy`, { headers: bHeaders })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/workspaces/ws_ops_meta`, { headers: bHeaders }).then(r => r.json())).status, 'not_configured')

  // Platform-admin console is admin-only; B and anonymous never see it.
  assert.equal((await fetch(`${base}/admin/`, { headers: proxyHeaders, redirect: 'manual' })).status, 308)
  assert.equal((await fetch(`${base}/admin/`, { headers: bHeaders })).status, 404)
  const adminPage = await fetch(`${base}/admin/`, { headers: { ...proxyHeaders, cookie: ownerCookie } })
  assert.equal(adminPage.status, 200)
  assert.match(await adminPage.text(), /平台管理/)

  // Revoking the grant invalidates B's live session immediately; a later regrant
  // cannot revive that dead token, so a fresh login is required.
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/workspaces`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ workspaceId: 'ws_ops_meta', granted: false }),
  })).status, 200)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: bHeaders })).status, 401)
  assert.equal((await fetch(`${base}/api/platform/workspaces`, { headers: bHeaders })).status, 401)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/workspaces`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ workspaceId: 'ws_ops_meta', granted: true }),
  })).status, 200)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: bHeaders })).status, 401)
  const bRelogin = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'member-b', password: bPassword }),
  })
  assert.equal(bRelogin.status, 200)
  const bReHeaders = { ...proxyHeaders, cookie: cookieOf(bRelogin) }
  assert.deepEqual((await fetch(`${base}/api/platform/workspaces`, { headers: bReHeaders }).then(r => r.json()))
    .workspaces.map(ws => ws.workspaceId), ['ws_ops_meta'])

  // Disable invalidates B's live session immediately; logout clears cookies.
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: false }),
  })).status, 204)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: bReHeaders })).status, 401)
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: bReHeaders })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'member-b', password: bPassword }),
  })).status, 401)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: true }),
  })).status, 204)
  assert.equal((await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'member-b', password: bPassword }),
  })).status, 200)

  // Tampered session, self-lockout and platform-admin protections.
  assert.equal((await fetch(`${base}/api/platform/session`, {
    headers: { ...proxyHeaders, cookie: `happyspa_personal_workbench=${ownerCookie.split('=', 2)[1]}x` },
  })).status, 401)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: true }),
  })).status, 204)
  const ownerAccountId = (await fetch(`${base}/api/platform/admin/accounts`, { headers: ownerHeaders })
    .then(r => r.json())).accounts.find(account => account.legacyOwner).accountId
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${ownerAccountId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: false }),
  })).status, 409)

  // Logout for both session types.
  const logout = await fetch(`${base}/api/platform/logout`, { method: 'POST', headers: { ...proxyHeaders, origin } })
  assert.equal(logout.status, 204)
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/)
  // Bodyless DELETE /api/personal-workbench/session is still a mutation: it
  // requires the trusted proxy plus the exact same Origin, but no Content-Type.
  const legacySessionCookie = cookieOf(entry)
  const legacySessionWithCookie = { ...proxyHeaders, cookie: legacySessionCookie }
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: legacySessionWithCookie })).status, 200)
  assert.equal((await fetch(`${base}/api/personal-workbench/session`, {
    method: 'DELETE', headers: legacySessionWithCookie,
  })).status, 404)
  assert.equal((await fetch(`${base}/api/personal-workbench/session`, {
    method: 'DELETE', headers: { ...legacySessionWithCookie, origin: 'https://attacker.example' },
  })).status, 404)
  // The blocked attempts never cleared the cookie, so the session still works.
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: legacySessionWithCookie })).status, 200)
  const legacyLogout = await fetch(`${base}/api/personal-workbench/session`, {
    method: 'DELETE', headers: { ...legacySessionWithCookie, origin },
  })
  assert.equal(legacyLogout.status, 204)
  assert.match(legacyLogout.headers.get('set-cookie') || '', /Max-Age=0/)
  // The newly-issued legacy token is durably revoked, not just cleared.
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: legacySessionWithCookie })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: legacySessionWithCookie })).status, 401)

  // Server-side per-token revocation: logout of one account session must not
  // revoke another session for the same account.
  const ownerLoginA = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })
  const ownerLoginB = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: ownerName, password: ownerPassword }),
  })
  assert.equal(ownerLoginA.status, 200)
  assert.equal(ownerLoginB.status, 200)
  const ownerCookieA = cookieOf(ownerLoginA)
  const ownerCookieB = cookieOf(ownerLoginB)
  assert.notEqual(ownerCookieA, ownerCookieB)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: ownerCookieA } })).status, 200)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: ownerCookieB } })).status, 200)
  const ownerLogoutB = await fetch(`${base}/api/platform/logout`, {
    method: 'POST', headers: { ...proxyHeaders, origin, cookie: ownerCookieB },
  })
  assert.equal(ownerLogoutB.status, 204)
  assert.match(ownerLogoutB.headers.get('set-cookie') || '', /Max-Age=0/)
  // The exact logged-out token is rejected; the sibling session stays valid.
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: ownerCookieB } })).status, 401)
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: { ...proxyHeaders, cookie: ownerCookieB } })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: ownerCookieA } })).status, 200)
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: { ...proxyHeaders, cookie: ownerCookieA } })).status, 200)
  // A malformed cookie creates no revocation and never clears a valid session.
  const forgedCookie = `${ownerCookieA.split('.')[0]}.forged-signature`
  assert.equal((await fetch(`${base}/api/platform/logout`, {
    method: 'POST', headers: { ...proxyHeaders, origin, cookie: forgedCookie },
  })).status, 204)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: ownerCookieA } })).status, 200)

  // A genuine pre-migration legacy token (signed claims with no `type`) is
  // accepted before logout and rejected after the durable revocation.
  const entryKeyVersion = createHash('sha256').update('test-only-entry-key').digest('hex')
  const legacyNow = Date.now()
  const legacyPayload = Buffer.from(JSON.stringify({
    role: 'personal-workbench', scope: 'personal-workbench', username: ownerName,
    exp: Math.floor(legacyNow / 86400000), personalWorkbenchExpiresAt: legacyNow + 8 * 60 * 60 * 1000,
    personalWorkbenchKeyVersion: entryKeyVersion,
  })).toString('base64url')
  const oldFormatLegacy = `${legacyPayload}.${createHmac('sha256', 'test-only-auth-secret').update(legacyPayload).digest('base64url')}`
  const oldLegacyHeaders = { ...proxyHeaders, cookie: `happyspa_personal_workbench=${oldFormatLegacy}` }
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: oldLegacyHeaders })).status, 200)
  const oldLegacyLogout = await fetch(`${base}/api/personal-workbench/session`, {
    method: 'DELETE', headers: { ...oldLegacyHeaders, origin },
  })
  assert.equal(oldLegacyLogout.status, 204)
  assert.match(oldLegacyLogout.headers.get('set-cookie') || '', /Max-Age=0/)
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: oldLegacyHeaders })).status, 404)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: oldLegacyHeaders })).status, 401)

  // A valid token already invalidated by session_version can still be individually blacklisted.
  const staleLogin = await fetch(`${base}/api/platform/login`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'member-b', password: bPassword }),
  })
  assert.equal(staleLogin.status, 200)
  const staleCookie = cookieOf(staleLogin)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: staleCookie } })).status, 200)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: false }),
  })).status, 204)
  assert.equal((await fetch(`${base}/api/platform/session`, { headers: { ...proxyHeaders, cookie: staleCookie } })).status, 401)
  const staleLogout = await fetch(`${base}/api/platform/logout`, {
    method: 'POST', headers: { ...proxyHeaders, origin, cookie: staleCookie },
  })
  assert.equal(staleLogout.status, 204)
  assert.equal((await fetch(`${base}/api/platform/admin/accounts/${bId}/enabled`, {
    method: 'POST', headers: ownerHeaders, body: JSON.stringify({ enabled: true }),
  })).status, 204)

  // A's account session still works and A's Life OS data is intact.
  assert.equal((await fetch(`${base}/workbench/api/app-state`, { headers: { ...proxyHeaders, cookie: ownerCookie } })).status, 200)
  assert.equal((await fetch(`${base}/internal/health`)).status, 200)
  console.log('Unified login, platform-admin account/workspace/grant constraints, B denial across Life OS prefixes/IDOR/agent, workspace not-configured landing, session invalidation, durable per-token logout revocation (account, legacy, old-format, isolated sessions), header/origin/host hardening and dual logout checks passed.')
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => agent.close(resolve))
  await new Promise(resolve => setTimeout(resolve, 100))
  rmSync(temp, { recursive: true, force: true })
}
