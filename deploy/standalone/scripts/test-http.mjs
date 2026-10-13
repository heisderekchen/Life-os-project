import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createHttpServer } from 'node:http'
import { signWorkspaceSubject } from '../../../agent-service/src/http.js'

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temp = mkdtempSync(join(tmpdir(), 'lifeos-http-test-'))
const nextDir = join(temp, 'next')
const { mkdirSync } = await import('node:fs')
mkdirSync(nextDir)
writeFileSync(join(nextDir, 'server.js'), `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('mock next '+req.url)}).listen(Number(process.env.PORT),'127.0.0.1')`)
const port = await freePort()
const nextPort = await freePort()
const agentRequests = []
const agent = createHttpServer((req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    agentRequests.push({ method: req.method, target: req.url, headers: req.headers, body })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url === '/v1/health'
      ? { status: 'ok', taskTrigger: 'approved_worker', providers: { deepseek: true, openai: false } }
      : { ok: true }))
  })
})
await new Promise(resolve => agent.listen(0, '127.0.0.1', resolve))
const agentPort = agent.address().port
const origin = `https://127.0.0.1:${port}`
const setupKey = Buffer.alloc(32, 7).toString('base64url')
const setupGrant = `v2.production.${Math.floor(Date.now() / 1000) + 1200}.${setupKey}`
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: temp,
  env: { ...process.env, DATABASE_URL: `file:${join(temp, 'lifeos.db')}`, AUTH_SECRET: 'test-only-auth-secret',
    PERSONAL_WORKBENCH_ENTRY_KEY: 'test-only-entry-key', GATEWAY_PORT: String(port), NEXT_PORT: String(nextPort), NEXT_ROOT: nextDir,
    LIFEOS_LISTEN_HOST: '127.0.0.1',
    ENVIRONMENT: 'production', LIFEOS_PUBLIC_ORIGIN: origin, TRUSTED_PROXY_IP: '127.0.0.1',
    PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED: 'true', PERSONAL_WORKBENCH_OWNER_SETUP_GRANT: setupGrant,
    LIFEOS_RECURRENCE_ENABLED: 'false',
    AGENT_SERVICE_URL: `http://127.0.0.1:${agentPort}`, AGENT_SERVICE_TOKEN: 'test-service-token',
    WORKSPACE_SUBJECT_SIGNING_SECRET: 'test-signing-secret' },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${port}`
async function waitReady() {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`)
    try { if ((await fetch(`${base}/internal/health`)).ok) return }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('server did not become healthy')
}
try {
  await waitReady()
  assert.deepEqual(await fetch(`${base}/internal/health`).then(r => r.json()), { ok: true, recurrenceEnabled: false })
  const login = await fetch(`${base}/`)
  assert.equal(login.status, 200)
  const loginHtml = await login.text()
  assert.match(loginHtml, /私人 Life OS/)
  assert.match(loginHtml, /<meta name="viewport" content="width=device-width,initial-scale=1">/)
  assert.ok(loginHtml.includes('.box{box-sizing:border-box;width:min(360px,calc(100% - 40px))'))
  const workbenchLogin = await fetch(`${base}/workbench/`)
  assert.equal(workbenchLogin.status, 200)
  assert.match(await workbenchLogin.text(), /私人 Life OS/)
  const workbenchRoot = await fetch(`${base}/workbench`, { redirect: 'manual' })
  assert.equal(workbenchRoot.status, 308)
  assert.equal(workbenchRoot.headers.get('location'), '/workbench/')
  assert.equal((await fetch(`${base}/workbench/api/app-state`)).status, 404)
  assert.equal((await fetch(`${base}/workbench/api/agent/health`)).status, 404)
  const spoofedEntry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: { origin: 'https://attacker.example', 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'test-only-entry-key' }),
  })
  assert.equal(spoofedEntry.status, 404)
  const malformedEntry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: { origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' }, body: '{invalid json',
  })
  assert.equal(malformedEntry.status, 401)
  const oversizedEntry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: { origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
    body: 'x'.repeat(1024 * 1024 + 128),
  })
  assert.equal(oversizedEntry.status, 413)
  assert.equal((await fetch(`${base}/internal/health`)).status, 200)
  const setupResponse = await fetch(`${base}/api/personal-workbench/owner-credential`, {
    method: 'POST', headers: { origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
    body: JSON.stringify({ setupKey, password: 'fixture-only-strong-password', confirmPassword: 'fixture-only-strong-password' }),
  })
  assert.equal(setupResponse.status, 204)
  const entry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: { origin, 'x-forwarded-proto': 'https',
      'content-type': 'application/json' }, body: JSON.stringify({ key: 'test-only-entry-key' }),
  })
  assert.equal(entry.status, 204)
  const cookie = entry.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/)
  const headers = { cookie: cookie.split(';', 1)[0], 'x-forwarded-proto': 'https' }
  const oversizedPrivateApi = await fetch(`${base}/workbench/api/app-state`, {
    method: 'PUT', headers: { ...headers, origin, 'content-type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 128),
  })
  assert.equal(oversizedPrivateApi.status, 413)
  assert.equal((await fetch(`${base}/internal/health`)).status, 200)
  const health = await fetch(`${base}/workbench/api/agent/health`, { headers })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).taskTrigger, 'approved_worker')
  const aiRequestBody = Buffer.from(JSON.stringify({ prompt: 'my task details' }))
  const aiResponse = await fetch(`${base}/workbench/api/agent/runs`, {
    method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json', 'idempotency-key': 'test-unique' },
    body: aiRequestBody,
  })
  assert.equal(aiResponse.status, 200)
  const forwarded = agentRequests.at(-1)
  assert.equal(forwarded.headers.authorization, 'Bearer test-service-token')
  assert.equal(forwarded.headers['x-workspace-subject'], 'heisderek')
  assert.equal(forwarded.headers['idempotency-key'], 'test-unique')
  assert.equal(forwarded.headers['x-workspace-subject-signature'], signWorkspaceSubject({
    subject: 'heisderek', timestamp: forwarded.headers['x-workspace-subject-timestamp'],
    nonce: forwarded.headers['x-workspace-subject-nonce'], method: 'POST', requestTarget: '/v1/runs',
    idempotencyKey: 'test-unique', body: aiRequestBody,
  }, 'test-signing-secret'))
  let stateResponse = await fetch(`${base}/workbench/api/app-state`, { headers })
  assert.equal(stateResponse.status, 200)
  let state = await stateResponse.json()
  assert.equal(state.initialized, false)
  stateResponse = await fetch(`${base}/workbench/api/app-state`, {
    method: 'PUT', headers: { ...headers, origin: `https://127.0.0.1:${port}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: null, preferences: { setupComplete: true, language: 'zh' } }),
  })
  assert.equal(stateResponse.status, 200)
  state = await stateResponse.json()
  assert.equal(state.setupComplete, true)
  const page = await fetch(`${base}/workbench/`, { headers })
  assert.equal(await page.text(), 'mock next /workbench/')
  const canonicalPage = await fetch(`${base}/workbench`, { headers })
  assert.equal(canonicalPage.status, 200)
  assert.equal(await canonicalPage.text(), 'mock next /workbench')
  console.log('HTTP private entry, /workbench login recovery, trusted HTTPS owner setup, malformed/oversize request handling, signed AI bridge, app-state sync, and recurrence-off health check passed.')
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => agent.close(resolve))
  await new Promise(resolve => setTimeout(resolve, 100))
  rmSync(temp, { recursive: true, force: true })
}
