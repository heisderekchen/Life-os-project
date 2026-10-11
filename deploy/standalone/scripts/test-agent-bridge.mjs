import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { createWorkspaceSubjectHeaders, mapAgentTarget } from '../agent-bridge.mjs'

const body = Buffer.from('{"prompt":"private task"}')
const requestTarget = '/v1/runs?limit=3'
const headers = createWorkspaceSubjectHeaders({
  ownerId: 'private-owner', method: 'POST', requestTarget, body,
  idempotencyKey: 'one-request', serviceToken: 'test-service-token', signingSecret: 'test-signing-secret',
  timestamp: '1791590400000', nonce: '1'.repeat(32),
})
const digest = createHash('sha256').update(body).digest('hex')
const canonical = JSON.stringify(['1791590400000', '1'.repeat(32), 'private-owner', 'POST', requestTarget, 'one-request', digest])
assert.equal(headers.authorization, 'Bearer test-service-token')
assert.equal(headers['x-workspace-subject'], 'private-owner')
assert.equal(headers['x-workspace-subject-signature'], createHmac('sha256', 'test-signing-secret').update(canonical).digest('hex'))
assert.equal(mapAgentTarget('/workbench/api/agent/health'), '/v1/health')
assert.equal(mapAgentTarget('/workbench/api/agent/runs', '?limit=3'), '/v1/runs?limit=3')
assert.equal(mapAgentTarget('/workbench/api/agent/runs/not-a-run/approve'), null)
assert.throws(() => createWorkspaceSubjectHeaders({ ownerId: 'bad\nowner', method: 'GET', requestTarget, serviceToken: 'x', signingSecret: 'y' }))
process.stdout.write('Agent bridge signing and route mapping passed.\n')
