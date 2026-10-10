import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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
const temp = mkdtempSync(join(tmpdir(), 'lifeos-http-test-'))
const nextDir = join(temp, 'next')
const { mkdirSync } = await import('node:fs')
mkdirSync(nextDir)
writeFileSync(join(nextDir, 'server.js'), `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('mock next '+req.url)}).listen(Number(process.env.PORT),'127.0.0.1')`)
const port = await freePort()
const nextPort = await freePort()
const child = spawn(process.execPath, [join(root, 'server.mjs')], {
  cwd: temp,
  env: { ...process.env, DATABASE_URL: `file:${join(temp, 'lifeos.db')}`, AUTH_SECRET: 'test-only-auth-secret',
    PERSONAL_WORKBENCH_ENTRY_KEY: 'test-only-entry-key', GATEWAY_PORT: String(port), NEXT_PORT: String(nextPort), NEXT_ROOT: nextDir },
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
  const login = await fetch(`${base}/`)
  assert.equal(login.status, 200)
  assert.match(await login.text(), /私人 Life OS/)
  assert.equal((await fetch(`${base}/workbench/api/app-state`)).status, 404)
  const entry = await fetch(`${base}/api/personal-workbench/entry`, {
    method: 'POST', headers: { origin: `https://127.0.0.1:${port}`, 'x-forwarded-proto': 'https',
      'content-type': 'application/json' }, body: JSON.stringify({ key: 'test-only-entry-key' }),
  })
  assert.equal(entry.status, 204)
  const cookie = entry.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/)
  const headers = { cookie: cookie.split(';', 1)[0], 'x-forwarded-proto': 'https' }
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
  console.log('HTTP private entry, secure cookie, anonymous denial, app-state sync, and protected Next asset routing passed.')
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 100))
  rmSync(temp, { recursive: true, force: true })
}
