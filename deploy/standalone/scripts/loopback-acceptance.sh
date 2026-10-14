#!/bin/sh
set -eu
if [ "$#" -gt 1 ]; then
  echo "Usage: loopback-acceptance.sh [bundle.tar.gz]" >&2
  exit 2
fi
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 24 ]; then
  echo "Node.js 24 or newer is required; found $(node --version)." >&2
  exit 1
fi
bundle=${1:-}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/lifeos-loopback.XXXXXX")
server_pid=
cleanup() {
  if [ -n "$server_pid" ]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT HUP INT TERM
if [ -n "$bundle" ]; then
  tar -xzf "$bundle" -C "$tmp"
else
  bundle_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
  if [ ! -f "$bundle_root/server.js" ] || [ ! -f "$bundle_root/deploy/standalone/server.mjs" ]; then
    echo "Pass the built bundle archive, or run this script from an extracted bundle." >&2
    exit 2
  fi
  cp -a "$bundle_root/." "$tmp/"
fi
(
  cd "$tmp"
  sha256sum -c MANIFEST.sha256 >/dev/null
)
ports=$(node --input-type=module -e '
import net from "node:net";
const reserve = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
console.log(`${await reserve()} ${await reserve()}`);
')
set -- $ports
gateway_port=$1
next_port=$2
auth_secret=$(node -p 'require("node:crypto").randomBytes(32).toString("base64url")')
entry_key=$(node -p 'require("node:crypto").randomBytes(32).toString("base64url")')
export AUTH_SECRET="$auth_secret"
export PERSONAL_WORKBENCH_ENTRY_KEY="$entry_key"
export GATEWAY_PORT="$gateway_port"
export NEXT_PORT="$next_port"
export NEXT_ROOT="$tmp"
export DATABASE_URL="file:$tmp/test-data/lifeos.db"
export LIFEOS_LISTEN_HOST=127.0.0.1
export LIFEOS_PUBLIC_ORIGIN="https://127.0.0.1:$gateway_port"
export TRUSTED_PROXY_IP=127.0.0.1
export ENVIRONMENT=production
export LIFEOS_RECURRENCE_ENABLED=false
mkdir -p "$tmp/test-data"
unset PERSONAL_WORKBENCH_OWNER_SETUP_ENABLED PERSONAL_WORKBENCH_OWNER_SETUP_GRANT
node "$tmp/deploy/standalone/server.mjs" >"$tmp/server.log" 2>&1 &
server_pid=$!
export LOOPBACK_PORT="$gateway_port"
export LOOPBACK_ORIGIN="$LIFEOS_PUBLIC_ORIGIN"
if ! node --input-type=module <<'EOF'
import assert from 'node:assert/strict'
const base = `http://127.0.0.1:${process.env.LOOPBACK_PORT}`
const origin = process.env.LOOPBACK_ORIGIN
let ready = false
for (let i = 0; i < 100; i++) {
  try {
    const response = await fetch(`${base}/internal/health`)
    if (response.ok) { ready = true; break }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 100))
}
assert.equal(ready, true, 'Node API did not become ready on loopback')
const health = await fetch(`${base}/internal/health`).then(r => r.json())
assert.deepEqual(health, { ok: true, recurrenceEnabled: false })
const login = await fetch(`${base}/workbench/`)
assert.equal(login.status, 200)
const loginHtml = await login.text()
assert.match(loginHtml, /<title>myOS · 统一登录<\/title>/)
assert.match(loginHtml, /HappySpa 工作台 · myOS/)
const commonHeaders = { origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json' }
const entry = await fetch(`${base}/api/personal-workbench/entry`, {
  method: 'POST', headers: commonHeaders,
  body: JSON.stringify({ key: process.env.PERSONAL_WORKBENCH_ENTRY_KEY }),
})
assert.equal(entry.status, 204)
const setCookie = entry.headers.get('set-cookie') || ''
const cookie = setCookie.split(';', 1)[0]
assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/)
const authHeaders = { ...commonHeaders, cookie }
const appState = await fetch(`${base}/workbench/api/app-state`, { headers: authHeaders })
assert.equal(appState.status, 200)
assert.equal((await appState.json()).initialized, false)
const projectResponse = await fetch(`${base}/workbench/api/projects`, {
  method: 'POST', headers: authHeaders,
  body: JSON.stringify({ name: 'Synthetic loopback project', color: '#123456' }),
})
assert.equal(projectResponse.status, 201)
const project = await projectResponse.json()
const taskResponse = await fetch(`${base}/workbench/api/tasks`, {
  method: 'POST', headers: authHeaders,
  body: JSON.stringify({ title: 'Synthetic loopback task', projectId: project.id, dueDate: '2026-10-11' }),
})
assert.equal(taskResponse.status, 201)
const tasks = await fetch(`${base}/workbench/api/tasks`, { headers: authHeaders }).then(r => r.json())
assert.equal(tasks.length, 1)
assert.equal(tasks[0].title, 'Synthetic loopback task')
let page
for (let i = 0; i < 50; i++) {
  page = await fetch(`${base}/workbench`, { headers: { cookie }, redirect: 'manual' })
  if (page.status === 200) break
  if (page.status >= 300 && page.status < 400) {
    throw new Error(`Authenticated frontend redirect ${page.status} to ${page.headers.get('location')}`)
  }
  await new Promise(resolve => setTimeout(resolve, 100))
}
assert.equal(page.status, 200)
assert.match(page.headers.get('content-type') || '', /text\/html/)
console.log('Loopback bundle acceptance passed: login, secure session, app-state, synthetic project/task persistence, frontend page; recurrence off.')
EOF
then
  echo "Loopback acceptance failed; sanitized service log follows:" >&2
  tail -n 30 "$tmp/server.log" >&2 || true
  exit 1
fi
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo "Life OS Node API exited during loopback acceptance." >&2
  tail -n 30 "$tmp/server.log" >&2 || true
  exit 1
fi
