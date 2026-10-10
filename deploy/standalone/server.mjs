import { createServer, request as httpRequest } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { createWorkspaceSubjectHeaders, mapAgentTarget } from './agent-bridge.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createD1Sqlite } from './d1-sqlite.mjs'
import { handlePersonalWorkbench, processLifeOsRecurringTasks } from './src/personal-workbench.mjs'
import { authenticatePersonalWorkbenchPassword, createPersonalWorkbenchOwnerCredential } from './src/personal-workbench-auth.mjs'
import { issueSessionToken, matchesEntryKey, verifySessionToken } from './session.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.GATEWAY_PORT || 3000)
const NEXT_PORT = Number(process.env.NEXT_PORT || 3001)
const NEXT_ROOT = process.env.NEXT_ROOT || '/app'
const BASE_PATH = process.env.LIFEOS_BASE_PATH || '/workbench'
const DB_PATH = (process.env.DATABASE_URL || 'file:/app/data/lifeos.db').replace(/^file:/, '')
const AUTH_SECRET = process.env.AUTH_SECRET || ''
const ENTRY_KEY = process.env.PERSONAL_WORKBENCH_ENTRY_KEY || ''
const COOKIE = 'happyspa_personal_workbench'
const MAX_BODY = 1024 * 1024

if (!AUTH_SECRET || !ENTRY_KEY) throw new Error('AUTH_SECRET and PERSONAL_WORKBENCH_ENTRY_KEY are required. Set them from the approved private-workbench secret source; no private endpoint starts without authentication.')

const sqlite = new DatabaseSync(DB_PATH)
sqlite.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
sqlite.exec(`CREATE TABLE IF NOT EXISTS lifeos_schema_migrations (
  name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`)
const applied = sqlite.prepare('SELECT name FROM lifeos_schema_migrations')
const appliedNames = new Set(applied.all().map(row => row.name))
const markMigration = sqlite.prepare('INSERT INTO lifeos_schema_migrations(name) VALUES (?)')
for (const name of readdirSync(join(HERE, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
  if (appliedNames.has(name)) continue
  const sql = readFileSync(join(HERE, 'migrations', name), 'utf8')
  sqlite.exec('BEGIN IMMEDIATE')
  try { sqlite.exec(sql); markMigration.run(name); sqlite.exec('COMMIT') }
  catch (error) { sqlite.exec('ROLLBACK'); throw error }
}

const env = {
  DB: createD1Sqlite(sqlite),
  AUTH_SECRET,
  PERSONAL_WORKBENCH_ENTRY_KEY: ENTRY_KEY,
  PERSONAL_WORKBENCH_OWNER: process.env.PERSONAL_WORKBENCH_OWNER || 'lifeos-owner',
  PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED: process.env.PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED || 'false',
  PERSONAL_WORKBENCH_OWNER_SETUP_GRANT: process.env.PERSONAL_WORKBENCH_OWNER_SETUP_GRANT || '',
}

function cookie(req) {
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)happyspa_personal_workbench=([^;]+)/)
  return match?.[1] || ''
}
function forwardedSecure(req) {
  const host = String(req.headers.host || '').split(':')[0]
  return req.headers['x-forwarded-proto'] === 'https' || host === 'localhost' || host === '127.0.0.1'
}
function sameOrigin(req) {
  const origin = req.headers.origin
  return origin && origin === `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('Request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
async function toWebRequest(req, url) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '))
    else if (value !== undefined) headers.set(key, value)
  }
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequest(req)
  return new Request(url, { method: req.method, headers, ...(body?.length ? { body, duplex: 'half' } : {}) })
}
async function sendWebResponse(res, response, extraHeaders = {}) {
  const headers = Object.fromEntries(response.headers.entries())
  res.writeHead(response.status, { ...headers, ...extraHeaders })
  res.end(Buffer.from(await response.arrayBuffer()))
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(data))
}
function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`
}
function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`
}
const LOGIN_HTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private Life OS</title><style>body{font:16px system-ui;background:#101216;color:#f5f5f5;display:grid;min-height:100vh;place-items:center;margin:0}.box{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #343842;border-radius:16px;background:#191c22}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #454a55;background:#101216;color:inherit}button{background:#b7f36b;color:#101216;border:0;font-weight:700;cursor:pointer}p{color:#c4c8d0}#error{color:#ff9393;min-height:1.4em}</style><main class="box"><h1>私人 Life OS</h1><p>输入现有私人工作台入口密钥。</p><form id="entry"><input id="key" type="password" autocomplete="current-password" required maxlength="256" aria-label="私人工作台入口密钥"><button>进入</button><p id="error" role="alert"></p></form></main><script>document.querySelector('#entry').addEventListener('submit',async e=>{e.preventDefault();const error=document.querySelector('#error');error.textContent='';try{const r=await fetch('/api/personal-workbench/entry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:document.querySelector('#key').value})});if(!r.ok)throw new Error('入口密钥无效或服务未配置。');location.replace('/workbench/')}catch(x){error.textContent=x.message}})</script></html>`

function mapPrivateApiPath(pathname) {
  const apiPrefix = `${BASE_PATH}/api/`
  if (!pathname.startsWith(apiPrefix)) return null
  const suffix = pathname.slice(`${BASE_PATH}/api`.length)
  const projectNamespace = suffix === '/projects' || suffix.startsWith('/projects/') ? '/compat' : ''
  const mapped = suffix === '/analytics' ? '/insights' : suffix
  return `/api/personal-workbench/lifeos${projectNamespace}${mapped}`
}

async function handlePublicAuth(req, res, pathname, requestUrl) {
  if (!['/api/personal-workbench/entry', '/api/personal-workbench/login', '/api/personal-workbench/owner-credential'].includes(pathname)) return false
  if (req.method !== 'POST' || !forwardedSecure(req) || !sameOrigin(req) || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    json(res, 404, { error: 'Private workbench entry is unavailable.' })
    return true
  }
  const request = await toWebRequest(req, requestUrl)
  if (pathname.endsWith('/entry')) {
    let body
    try { body = await request.clone().json() } catch { body = null }
    if (!matchesEntryKey(body?.key, ENTRY_KEY)) { json(res, 401, { error: 'Private link is invalid or expired.' }); return true }
    res.writeHead(204, { 'set-cookie': sessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, env.PERSONAL_WORKBENCH_OWNER)), 'cache-control': 'no-store' }); res.end(); return true
  }
  if (pathname.endsWith('/login')) {
    const result = await authenticatePersonalWorkbenchPassword(request, env)
    if (!result.username) { await sendWebResponse(res, result.response); return true }
    res.writeHead(204, { 'set-cookie': sessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, result.username)), 'cache-control': 'no-store' }); res.end(); return true
  }
  const response = await createPersonalWorkbenchOwnerCredential(request, env)
  if (response.status !== 204) { await sendWebResponse(res, response); return true }
  res.writeHead(204, { 'set-cookie': sessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, env.PERSONAL_WORKBENCH_OWNER)), 'cache-control': 'no-store' }); res.end(); return true
}


async function handleAgentApi(req, res, requestUrl, auth) {
  const target = mapAgentTarget(requestUrl.pathname, requestUrl.search, BASE_PATH)
  if (!target) { json(res, 404, { error: 'Not found' }); return }
  if (target.startsWith('/v1/health')) {
    const serviceUrl = process.env.AGENT_SERVICE_URL || ''
    const token = process.env.AGENT_SERVICE_TOKEN || ''
    const signingSecret = process.env.WORKSPACE_SUBJECT_SIGNING_SECRET || ''
    if (!serviceUrl || !token || !signingSecret) {
      json(res, 200, {
        enabled: false,
        reason: 'service_not_configured',
        taskTrigger: 'not_configured',
        providers: { deepseek: false, openai: false },
      })
      return
    }
    try {
      const response = await fetch(new URL(target, serviceUrl.endsWith('/') ? serviceUrl : serviceUrl + '/'), {
        method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error('AGENT_HEALTH_UNAVAILABLE')
      const health = await response.json()
      json(res, 200, { enabled: true, ...health })
    } catch {
      json(res, 200, {
        enabled: false,
        reason: 'service_unavailable',
        taskTrigger: 'not_configured',
        providers: { deepseek: false, openai: false },
      })
    }
    return
  }

  if (!['GET', 'POST', 'PATCH'].includes(req.method || 'GET')) {
    json(res, 405, { error: 'Method not allowed' }); return
  }
  if (req.method !== 'GET' && (!forwardedSecure(req) || !sameOrigin(req))) {
    json(res, 404, { error: 'Not found' }); return
  }
  const serviceUrl = process.env.AGENT_SERVICE_URL || ''
  const token = process.env.AGENT_SERVICE_TOKEN || ''
  const signingSecret = process.env.WORKSPACE_SUBJECT_SIGNING_SECRET || ''
  if (!serviceUrl || !token || !signingSecret) {
    json(res, 503, { error: 'AI_SERVICE_NOT_CONFIGURED' }); return
  }
  try {
    const body = req.method === 'GET' ? Buffer.alloc(0) : await readRequest(req)
    if (body.length > 32_000) { json(res, 413, { error: 'Request body too large' }); return }
    if (body.length && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      json(res, 415, { error: 'JSON required' }); return
    }
    const idempotencyKey = String(req.headers['idempotency-key'] || '')
    const headers = createWorkspaceSubjectHeaders({
      ownerId: auth.username,
      method: req.method || 'GET',
      requestTarget: target,
      body,
      idempotencyKey,
      serviceToken: token,
      signingSecret,
    })
    headers.accept = 'application/json'
    if (body.length) headers['content-type'] = 'application/json'
    const response = await fetch(new URL(target, serviceUrl.endsWith('/') ? serviceUrl : serviceUrl + '/'), {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const payload = Buffer.from(await response.arrayBuffer())
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(payload)
  } catch {
    json(res, 502, { error: 'AI_SERVICE_UNAVAILABLE' })
  }
}

async function handlePrivateApi(req, res, mappedPath, requestUrl, auth) {
  const request = await toWebRequest(req, requestUrl)
  const url = new URL(request.url)
  url.pathname = mappedPath
  const response = await handlePersonalWorkbench(request, env, url, auth)
  await sendWebResponse(res, response, { 'cache-control': 'no-store' })
}

function proxyToNext(req, res) {
  const upstream = httpRequest({ hostname: '127.0.0.1', port: NEXT_PORT, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode || 502, response.headers)
    response.pipe(res)
  })
  upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Life OS frontend unavailable' }); else res.destroy() })
  req.pipe(upstream)
}

const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  if (requestUrl.pathname === '/internal/health') return json(res, 200, { ok: true })
  if (requestUrl.pathname === '/' && verifySessionToken(cookie(req), AUTH_SECRET, ENTRY_KEY)) {
    res.writeHead(308, { location: `${BASE_PATH}/` }); res.end(); return
  }
  const auth = verifySessionToken(cookie(req), AUTH_SECRET, ENTRY_KEY)
  const agentPrefix = BASE_PATH + '/api/agent'
  if (requestUrl.pathname === agentPrefix || requestUrl.pathname.startsWith(agentPrefix + '/')) {
    if (!auth) return json(res, 404, { error: 'Not found' })
    return handleAgentApi(req, res, requestUrl, auth)
  }
  const apiPath = mapPrivateApiPath(requestUrl.pathname)
  const directAuthPath = requestUrl.pathname.startsWith('/api/personal-workbench/') ? requestUrl.pathname : null
  if (directAuthPath && await handlePublicAuth(req, res, directAuthPath, requestUrl)) return
  const apiTarget = apiPath || (directAuthPath ? directAuthPath : null)
  if (apiTarget) {
    if (!auth) return json(res, 404, { error: 'Not found' })
    if (requestUrl.pathname === '/api/personal-workbench/session' || requestUrl.pathname === `${BASE_PATH}/api/personal-workbench/session`) {
      if (req.method !== 'DELETE') return json(res, 404, { error: 'Not found' })
      res.writeHead(204, { 'set-cookie': clearCookie(), 'cache-control': 'no-store' }); res.end(); return
    }
    try { return await handlePrivateApi(req, res, apiTarget, requestUrl, auth) }
    catch (error) { console.error('Life OS API request failed', req.method, requestUrl.pathname, error?.message || 'unknown'); return json(res, 500, { error: 'Internal server error' }) }
  }
  if (requestUrl.pathname === BASE_PATH) {
    res.writeHead(308, { location: `${BASE_PATH}/` }); res.end(); return
  }
  if (requestUrl.pathname === '/' || requestUrl.pathname === `${BASE_PATH}`) {
    if (!verifySessionToken(cookie(req), AUTH_SECRET, ENTRY_KEY)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" })
      return res.end(LOGIN_HTML)
    }
    res.writeHead(308, { location: `${BASE_PATH}/` }); res.end(); return
  }
  if (!auth) return json(res, 404, { error: 'Not found' })
  if (requestUrl.pathname === `${BASE_PATH}/` || requestUrl.pathname.startsWith(`${BASE_PATH}/`)) return proxyToNext(req, res)
  return json(res, 404, { error: 'Not found' })
})

const next = spawn(process.execPath, ['server.js'], {
  cwd: NEXT_ROOT,
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(NEXT_PORT) },
  stdio: 'inherit',
})
next.on('exit', code => process.exit(code ?? 1))
server.listen(PORT, '0.0.0.0')
setInterval(() => { processLifeOsRecurringTasks(env).catch(error => console.error('Life OS recurrence runner failed', error?.message || 'unknown')) }, 60_000).unref()
process.on('SIGTERM', () => { server.close(); next.kill('SIGTERM'); sqlite.close() })
process.on('SIGINT', () => { server.close(); next.kill('SIGINT'); sqlite.close() })
