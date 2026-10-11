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
import { handleTaskCardApi, TASK_CARD_API_SUFFIX } from './src/task-cards.mjs'
import { handleResearchApi, RESEARCH_API_SUFFIX } from './src/research.mjs'
import { issueSessionToken, matchesEntryKey } from './session.mjs'
import {
  SESSION_COOKIE_NAME, buildClearSessionCookie, buildSessionCookie, ensurePlatformBootstrap,
  handlePlatformApi, isLegacyOwner, isPlatformAdmin, listGrantedWorkspaces, resolvePrincipal,
  pruneExpiredTokenRevocations, revokeSessionToken, syncConfiguredWorkspaces, workspacePageState,
} from './src/platform-auth.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.GATEWAY_PORT || 3000)
const LISTEN_HOST = process.env.LIFEOS_LISTEN_HOST || '0.0.0.0'
const NEXT_PORT = Number(process.env.NEXT_PORT || 3001)
const NEXT_ROOT = process.env.NEXT_ROOT || '/app'
const BASE_PATH = process.env.LIFEOS_BASE_PATH || '/workbench'
const DB_PATH = (process.env.DATABASE_URL || 'file:/app/data/lifeos.db').replace(/^file:/, '')
const AUTH_SECRET = process.env.AUTH_SECRET || ''
const ENTRY_KEY = process.env.PERSONAL_WORKBENCH_ENTRY_KEY || ''
const MAX_BODY = 1024 * 1024
const PUBLIC_ORIGIN_INPUT = process.env.LIFEOS_PUBLIC_ORIGIN || ''
let PUBLIC_ORIGIN
try {
  const parsedOrigin = new URL(PUBLIC_ORIGIN_INPUT)
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== PUBLIC_ORIGIN_INPUT || parsedOrigin.pathname !== '/') throw new Error('invalid origin')
  PUBLIC_ORIGIN = parsedOrigin.origin
} catch {
  throw new Error('LIFEOS_PUBLIC_ORIGIN must be the configured HTTPS origin.')
}
const TRUSTED_PROXY_IP = process.env.TRUSTED_PROXY_IP || ''
if (!TRUSTED_PROXY_IP) throw new Error('TRUSTED_PROXY_IP must identify the private Caddy container address.')
const ENVIRONMENT = process.env.ENVIRONMENT || 'development'
const RECURRENCE_ENABLED = process.env.LIFEOS_RECURRENCE_ENABLED === 'true'

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
  PLATFORM_WORKSPACES_JSON: process.env.PLATFORM_WORKSPACES_JSON || '',
  // Model identifiers only. The task-card catalog reads these to label each
  // provider entry with the operator-configured model; provider credentials
  // stay in the agent service (AGENT_SERVICE_TOKEN) and are never copied here.
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL || '',
  ENVIRONMENT,
}

function cookie(req) {
  const match = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))
  return match?.[1] || ''
}
function forwardedSecure(req) {
  const remoteAddress = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  return remoteAddress === TRUSTED_PROXY_IP
    && req.headers['x-forwarded-proto'] === 'https'
    && String(req.headers.host || '').toLowerCase() === new URL(PUBLIC_ORIGIN).host.toLowerCase()
}
function sameOrigin(req) {
  return forwardedSecure(req) && req.headers.origin === PUBLIC_ORIGIN
}
function mutationRequestAllowed(req) {
  return forwardedSecure(req) && sameOrigin(req)
    && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')
}
// The legacy Life OS module only understands the legacy principal shape. It is
// reachable solely for the legacy owner (account A), never for account B.
function moduleAuthForPrincipal(principal) {
  if (!principal || !isLegacyOwner(principal)) return null
  return { role: 'personal-workbench', scope: 'personal-workbench', username: principal.username }
}

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY) {
        settled = true
        const error = new Error('BODY_TOO_LARGE')
        error.code = 'BODY_TOO_LARGE'
        reject(error)
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)) } })
    req.on('error', error => { if (!settled) { settled = true; reject(error) } })
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
const LOGIN_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>统一登录 · 私人 Life OS</title><style>body{font:16px system-ui;background:#101216;color:#f5f5f5;display:grid;min-height:100vh;place-items:center;margin:0}.box{box-sizing:border-box;width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #343842;border-radius:16px;background:#191c22}h1{font-size:22px;margin:0 0 6px}p{color:#c4c8d0;margin:6px 0}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #454a55;background:#101216;color:inherit}button{background:#b7f36b;color:#101216;border:0;font-weight:700;cursor:pointer}details{margin-top:16px;color:#c4c8d0}summary{cursor:pointer}label{display:block;margin-top:12px;color:#c4c8d0;font-size:14px}#error{color:#ff9393;min-height:1.4em}</style></head><body><main class="box"><h1>统一登录</h1><p>HappySpa 工作台 · 私人 Life OS</p><form id="login"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required maxlength="128"><button>登录</button><p id="error" role="alert"></p></form><details><summary>使用旧版入口密钥（仅限旧版 Life OS 所有者）</summary><form id="entry"><label for="key">旧版入口密钥</label><input id="key" type="password" autocomplete="current-password" required maxlength="256"><button>进入</button></form></details></main><script>const err=document.querySelector('#error');document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();err.textContent='';try{const rt=new URLSearchParams(location.search).get('returnTo');const r=await fetch('/api/platform/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value,returnTo:rt||undefined})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'登录失败。');location.replace(data.returnTo||'/')}catch(x){err.textContent=x.message}});document.querySelector('#entry').addEventListener('submit',async e=>{e.preventDefault();err.textContent='';try{const r=await fetch('/api/personal-workbench/entry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:document.querySelector('#key').value})});if(!r.ok)throw new Error('入口密钥无效或服务未配置。');location.replace('/workbench/')}catch(x){err.textContent=x.message}})</script></body></html>`

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
  const publicRequestUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, PUBLIC_ORIGIN)
  const request = await toWebRequest(req, publicRequestUrl)
  if (pathname.endsWith('/entry')) {
    let body
    try { body = await request.clone().json() } catch { body = null }
    if (!matchesEntryKey(body?.key, ENTRY_KEY)) { json(res, 401, { error: 'Private link is invalid or expired.' }); return true }
    res.writeHead(204, { 'set-cookie': buildSessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, env.PERSONAL_WORKBENCH_OWNER)), 'cache-control': 'no-store' }); res.end(); return true
  }
  if (pathname.endsWith('/login')) {
    const result = await authenticatePersonalWorkbenchPassword(request, env)
    if (!result.username) { await sendWebResponse(res, result.response); return true }
    res.writeHead(204, { 'set-cookie': buildSessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, result.username)), 'cache-control': 'no-store' }); res.end(); return true
  }
  const response = await createPersonalWorkbenchOwnerCredential(request, env)
  if (response.status !== 204) { await sendWebResponse(res, response); return true }
  res.writeHead(204, { 'set-cookie': buildSessionCookie(issueSessionToken(AUTH_SECRET, ENTRY_KEY, env.PERSONAL_WORKBENCH_OWNER)), 'cache-control': 'no-store' }); res.end(); return true
}


// Read-only readiness probe for the local AI service. It reads no provider key
// and makes no provider call; it only reports which provider profiles the
// service has configured, so the Worker catalog can label each entry.
let agentHealthCache = { at: 0, value: null }
async function readAgentServiceHealth() {
  if (Date.now() - agentHealthCache.at < 5000) return agentHealthCache.value
  const serviceUrl = process.env.AGENT_SERVICE_URL || ''
  if (!serviceUrl) {
    agentHealthCache = { at: Date.now(), value: null }
    return null
  }
  try {
    const response = await fetch(new URL('/v1/health', serviceUrl.endsWith('/') ? serviceUrl : serviceUrl + '/'), {
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error('AGENT_HEALTH_UNAVAILABLE')
    const health = await response.json()
    const value = health && typeof health === 'object' ? health : null
    agentHealthCache = { at: Date.now(), value }
    return value
  } catch {
    // A short negative cache keeps an unreachable service from adding its
    // timeout to every card request.
    agentHealthCache = { at: Date.now(), value: null }
    return null
  }
}

// Task-card + Worker-routing API (MVP). Scope is resolved per request inside
// the module against the exact ws_lifeos_legacy grant.
async function handleTaskCardRequest(req, res, requestUrl, principal) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    // Card and routing mutations must never accept cross-origin requests.
    if (!forwardedSecure(req) || !sameOrigin(req)) return json(res, 404, { error: 'Not found' })
    if (method !== 'DELETE' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return json(res, 415, { error: 'JSON required' })
    }
  }
  const publicRequestUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, PUBLIC_ORIGIN)
  const request = await toWebRequest(req, publicRequestUrl)
  const response = await handleTaskCardApi(request, env, requestUrl, principal, {
    basePath: BASE_PATH, agentHealth: await readAgentServiceHealth(),
  })
  if (!response) return json(res, 404, { error: 'Not found' })
  return sendWebResponse(res, response, { 'cache-control': 'no-store' })
}

// Research state-machine + disabled-by-default Obsidian outbox API. Scope is
// resolved per request inside the module against the exact ws_lifeos_legacy
// grant. No executor is injected: the module keeps every start at
// `waiting_executor` and never schedules or calls a provider. No vault path or
// filesystem write is configured here while vault permission is pending.
async function handleResearchRequest(req, res, requestUrl, principal) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    // Session, round and outbox mutations must never accept cross-origin requests.
    if (!forwardedSecure(req) || !sameOrigin(req)) return json(res, 404, { error: 'Not found' })
    if (method !== 'DELETE' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return json(res, 415, { error: 'JSON required' })
    }
  }
  const publicRequestUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, PUBLIC_ORIGIN)
  const request = await toWebRequest(req, publicRequestUrl)
  const response = await handleResearchApi(request, env, requestUrl, principal, {
    basePath: BASE_PATH,
  })
  if (!response) return json(res, 404, { error: 'Not found' })
  return sendWebResponse(res, response, { 'cache-control': 'no-store' })
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
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') { json(res, 413, { error: 'Request body too large' }); return }
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

function sendLoginPage(res) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  })
  res.end(LOGIN_HTML)
}

const WORKSPACE_PAGE_STYLE = 'body{font:16px system-ui;background:#101216;color:#f5f5f5;display:grid;min-height:100vh;place-items:center;margin:0}.box{box-sizing:border-box;width:min(480px,calc(100% - 40px));padding:28px;border:1px solid #343842;border-radius:16px;background:#191c22}a{color:#b7f36b}h1{font-size:22px;margin:0 0 8px}li{margin:8px 0}p{color:#c4c8d0}'
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

function sendWorkspacePage(res, status, title, bodyHtml) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${WORKSPACE_PAGE_STYLE}</style></head><body><main class="box"><h1>${escapeHtml(title)}</h1>${bodyHtml}</main></body></html>`)
}

async function sendWorkspaceList(res, env, principal) {
  const workspaces = await listGrantedWorkspaces(env, principal.accountId)
  const items = workspaces.length
    ? `<ul>${workspaces.map(workspace => `<li><a href="/workspace/${escapeHtml(workspace.slug)}">${escapeHtml(workspace.displayName)}</a>${workspace.configured ? '' : ' · 未配置'}</li>`).join('')}</ul>`
    : '<p>尚未分配任何工作区，请联系平台管理员。</p>'
  sendWorkspacePage(res, 200, '我的工作区',
    items + (isPlatformAdmin(principal) ? '<p><a href="/admin/">平台管理</a></p>' : ''))
}

async function sendWorkspaceLanding(res, env, principal, slug) {
  const state = await workspacePageState(env, principal, slug)
  if (state.status === 'not_found') return json(res, 404, { error: 'Not found' })
  if (state.status === 'not_configured') {
    return sendWorkspacePage(res, 200, state.workspace.displayName,
      '<p>该工作区尚未配置应用入口，请联系平台管理员。</p>')
  }
  res.writeHead(302, { location: state.workspace.applicationTarget, 'cache-control': 'no-store' })
  res.end()
}

// Minimal platform-admin console. It only calls the admin endpoints over the
// same origin; authority is re-checked server-side on every call.
const ADMIN_PAGE_STYLE = WORKSPACE_PAGE_STYLE
  + 'table{width:100%;border-collapse:collapse}th,td{padding:6px 4px;border-bottom:1px solid #343842;font-size:14px;text-align:left}button{background:#b7f36b;color:#101216;border:0;border-radius:6px;padding:6px 10px;margin:2px;cursor:pointer;font-weight:600}input{box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #454a55;background:#101216;color:inherit;width:100%;margin-top:8px}form{margin-top:12px}#msg{color:#ff9393;min-height:1.4em}small{color:#9aa0aa}'
const ADMIN_SCRIPT = `const msg=document.querySelector('#msg');function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}async function req(path,opts){const r=await fetch(path,opts||{});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(e){}if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d}async function load(){const a=await req('/api/platform/admin/accounts');const w=await req('/api/platform/admin/workspaces');render(a.accounts||[],w.workspaces||[])}function render(accounts,workspaces){document.querySelector('#who').textContent=ACCOUNT.principal.username;document.querySelector('#accounts').innerHTML='<tr><th>账号</th><th>角色</th><th>状态</th><th>工作区</th><th>操作</th></tr>'+accounts.map(function(a){const role=a.legacyOwner||a.role==='platform_admin'?'平台管理员':'普通成员';const grants=(a.workspaces||[]).map(function(id){const w=workspaces.filter(function(x){return x.workspaceId===id})[0];return w?w.displayName:id}).join('、')||'—';const actions=(a.legacyOwner||a.role==='platform_admin')?'—':'<button data-act="toggle" data-id="'+esc(a.accountId)+'" data-enabled="'+(a.enabled?1:0)+'">'+(a.enabled?'停用':'启用')+'</button><button data-act="password" data-id="'+esc(a.accountId)+'">设置密码</button><button data-act="grant" data-id="'+esc(a.accountId)+'">授权工作区</button>';return '<tr><td>'+esc(a.username)+'</td><td>'+esc(role)+'</td><td>'+(a.enabled?'启用':'停用')+'</td><td>'+esc(grants)+'</td><td>'+actions+'</td></tr>'}).join('');document.querySelector('#workspaces').innerHTML=workspaces.map(function(w){return '<li>'+esc(w.displayName)+' <small>'+esc(w.slug)+' · '+(w.configured?'已配置 '+esc(w.applicationTarget):'未配置')+'</small></li>'}).join('')}document.querySelector('#accounts').addEventListener('click',async function(e){const b=e.target.closest('button');if(!b)return;try{if(b.dataset.act==='toggle'){await req('/api/platform/admin/accounts/'+b.dataset.id+'/enabled',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:b.dataset.enabled!=='1'})})}else if(b.dataset.act==='password'){const p=prompt('输入新密码（14-128 位）');if(!p)return;await req('/api/platform/admin/accounts/'+b.dataset.id+'/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p})})}else if(b.dataset.act==='grant'){const w=prompt('输入工作区 ID，例如 ws_ops_meta');if(!w)return;const g=prompt('输入 grant 授权，或 revoke 撤销','grant');if(!g)return;await req('/api/platform/admin/accounts/'+b.dataset.id+'/workspaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:w.trim(),granted:g.trim().toLowerCase()==='grant'})})}msg.textContent='已更新'}catch(x){msg.textContent=x.message}load()});document.querySelector('#create').addEventListener('submit',async function(e){e.preventDefault();try{await req('/api/platform/admin/accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.querySelector('#newuser').value.trim()})});document.querySelector('#newuser').value='';msg.textContent='账号已创建，请为其设置密码'}catch(x){msg.textContent=x.message}load()});load();`

function sendAdminPage(res, principal) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  })
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>平台管理</title><style>${ADMIN_PAGE_STYLE}</style></head><body><main class="box"><h1>平台管理</h1><p>当前账号：<span id="who"></span></p><h2>账号</h2><table id="accounts"></table><form id="create"><input id="newuser" placeholder="新账号用户名（3-64 位小写字母/数字/._-）" required maxlength="64" autocomplete="off"><button>创建普通账号</button></form><h2>工作区目录</h2><ul id="workspaces"></ul><p id="msg" role="alert"></p></main><script>const ACCOUNT=${JSON.stringify({ principal: { username: principal.username } })};${ADMIN_SCRIPT}</script></body></html>`)
}

async function handlePlatformRequest(req, res, requestUrl, principal) {
  const method = req.method || 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    // Login/auth/admin mutations must never accept cross-origin requests.
    if (!forwardedSecure(req) || !sameOrigin(req)) return json(res, 404, { error: 'Not found' })
    const needsJson = requestUrl.pathname === '/api/platform/login'
      || requestUrl.pathname.startsWith('/api/platform/admin/')
    if (needsJson && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return json(res, 415, { error: 'JSON required' })
    }
  }
  const publicRequestUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, PUBLIC_ORIGIN)
  const request = await toWebRequest(req, publicRequestUrl)
  const response = await handlePlatformApi(request, env, requestUrl, principal)
  if (!response) return json(res, 404, { error: 'Not found' })
  return sendWebResponse(res, response, { 'cache-control': 'no-store' })
}

const server = createServer((req, res) => {
  void handleHttpRequest(req, res).catch(error => {
    if (res.destroyed) return
    if (res.headersSent) { res.destroy(); return }
    const code = error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'REQUEST_FAILED'
    const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500
    console.error('Life OS request failed', req.method || 'UNKNOWN', code)
    json(res, status, { error: code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Internal server error' })
  })
})

async function handleHttpRequest(req, res) {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = requestUrl.pathname
  if (pathname === '/internal/health') return json(res, 200, { ok: true, recurrenceEnabled: RECURRENCE_ENABLED })

  // Authority is always re-resolved from SQLite so disable, grant revocation
  // and password change (session_version) invalidate immediately.
  let principal = null
  try { principal = await resolvePrincipal(env, cookie(req)) } catch { principal = null }
  const moduleAuth = moduleAuthForPrincipal(principal)

  const directAuthPath = pathname.startsWith('/api/personal-workbench/') ? pathname : null
  if (directAuthPath && await handlePublicAuth(req, res, directAuthPath, requestUrl)) return

  if (pathname === '/api/platform' || pathname.startsWith('/api/platform/')) {
    return handlePlatformRequest(req, res, requestUrl, principal)
  }

  const agentPrefix = BASE_PATH + '/api/agent'
  if (pathname === agentPrefix || pathname.startsWith(agentPrefix + '/')) {
    if (!moduleAuth) return json(res, 404, { error: 'Not found' })
    return handleAgentApi(req, res, requestUrl, moduleAuth)
  }

  const taskCardPrefix = BASE_PATH + TASK_CARD_API_SUFFIX
  if (pathname === taskCardPrefix || pathname.startsWith(taskCardPrefix + '/')) {
    return handleTaskCardRequest(req, res, requestUrl, principal)
  }

  const researchPrefix = BASE_PATH + RESEARCH_API_SUFFIX
  if (pathname === researchPrefix || pathname.startsWith(researchPrefix + '/')) {
    return handleResearchRequest(req, res, requestUrl, principal)
  }

  const apiTarget = mapPrivateApiPath(pathname) || directAuthPath
  if (apiTarget) {
    if (!moduleAuth) return json(res, 404, { error: 'Not found' })
    if (pathname === '/api/personal-workbench/session' || pathname === `${BASE_PATH}/api/personal-workbench/session`) {
      if (req.method !== 'DELETE') return json(res, 404, { error: 'Not found' })
      // This bodyless logout is still a mutation action: require the trusted
      // HTTPS proxy and the exact same Origin before clearing the session. No
      // Content-Type is required because the request carries no body.
      if (!forwardedSecure(req) || !sameOrigin(req)) return json(res, 404, { error: 'Not found' })
      // Revoke the exact presented legacy token durably before clearing the
      // cookie; a persistent-revocation failure must fail closed.
      const revocation = await revokeSessionToken(env, cookie(req))
      if (revocation.failed) return json(res, 503, { error: '退出登录失败，请稍后重试。' })
      res.writeHead(204, { 'set-cookie': buildClearSessionCookie(), 'cache-control': 'no-store' }); res.end(); return
    }
    if (!['GET', 'HEAD'].includes(req.method || 'GET') && !mutationRequestAllowed(req)) {
      return json(res, 404, { error: 'Not found' })
    }
    try { return await handlePrivateApi(req, res, apiTarget, requestUrl, moduleAuth) }
    catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') return json(res, 413, { error: 'Request body too large' })
      console.error('Life OS API request failed', req.method, pathname, error?.message || 'unknown')
      return json(res, 500, { error: 'Internal server error' })
    }
  }

  if (pathname === '/workspaces' || pathname === '/workspaces/') {
    if (!principal) { res.writeHead(308, { location: '/' }); res.end(); return }
    return sendWorkspaceList(res, env, principal)
  }
  if (pathname === '/admin' || pathname === '/admin/') {
    if (!principal) { res.writeHead(308, { location: '/' }); res.end(); return }
    if (!isPlatformAdmin(principal)) return json(res, 404, { error: 'Not found' })
    return sendAdminPage(res, principal)
  }
  const workspacePage = pathname.match(/^\/workspace\/([a-z0-9-]{1,64})\/?$/)
  if (workspacePage) {
    if (!principal) { res.writeHead(308, { location: '/' }); res.end(); return }
    return sendWorkspaceLanding(res, env, principal, workspacePage[1])
  }

  if (pathname === BASE_PATH) {
    if (moduleAuth) return proxyToNext(req, res)
    if (!principal) { res.writeHead(308, { location: `${BASE_PATH}/` }); res.end(); return }
    return json(res, 404, { error: 'Not found' })
  }
  if (pathname === '/' || pathname === `${BASE_PATH}/`) {
    if (!principal) return sendLoginPage(res)
    if (moduleAuth) {
      if (pathname === '/') { res.writeHead(308, { location: `${BASE_PATH}/` }); res.end(); return }
      return proxyToNext(req, res)
    }
    if (pathname === '/') { res.writeHead(308, { location: '/workspaces/' }); res.end(); return }
    return json(res, 404, { error: 'Not found' })
  }
  if (!principal) return json(res, 404, { error: 'Not found' })
  if (moduleAuth && (pathname === `${BASE_PATH}/` || pathname.startsWith(`${BASE_PATH}/`))) return proxyToNext(req, res)
  return json(res, 404, { error: 'Not found' })
}

// Deterministic, password-free bootstrap of the legacy owner account and any
// operator-declared workspace metadata. Never creates account B or a password.
await ensurePlatformBootstrap(env)
await syncConfiguredWorkspaces(env)
// Best-effort cleanup of already-expired revocation rows on startup.
await pruneExpiredTokenRevocations(env)

const next = spawn(process.execPath, ['server.js'], {
  cwd: NEXT_ROOT,
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(NEXT_PORT) },
  stdio: 'inherit',
})
next.on('exit', code => process.exit(code ?? 1))
server.listen(PORT, LISTEN_HOST)
if (RECURRENCE_ENABLED) {
  setInterval(() => { processLifeOsRecurringTasks(env).catch(error => console.error('Life OS recurrence runner failed', error?.message || 'unknown')) }, 60_000).unref()
}
process.on('SIGTERM', () => { server.close(); next.kill('SIGTERM'); sqlite.close() })
process.on('SIGINT', () => { server.close(); next.kill('SIGINT'); sqlite.close() })
