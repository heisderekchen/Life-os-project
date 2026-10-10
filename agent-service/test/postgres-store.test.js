import test from 'node:test'
import assert from 'node:assert/strict'
import { PostgresStore } from '../src/postgres-store.js'

// These tests inspect SQL boundaries with a fake adapter. They do not execute
// against PostgreSQL and are not evidence of database durability.
function dbRunRow() {
  return {
    id: 'fixed-run-id', owner_id: 'owner-1', idempotency_key: 'same-key',
    request_fingerprint: 'fingerprint', request: { prompt: 'draft' },
    provider: 'deepseek', model: 'deepseek-flash', budget_usd: '0.1',
    max_output_tokens: 1200, data_scope: { mode: 'user_input_only' }, version: 1,
    state: 'queued', approval: { version: 1, fingerprint: 'approved' }, lease_epoch: '7',
    provider_run_id: null, usage: null, estimated_cost_usd: null,
    result: null, error_code: null, created_at: new Date(), updated_at: new Date(),
  }
}

test('idempotency key is owner-scoped and mismatched payload is rejected by SQL predicate', async () => {
  let captured
  const pool = { async query(text, values) { captured = { text, values }; return { rowCount: 1, rows: [dbRunRow()] } } }
  const store = new PostgresStore(pool)
  const run = await store.createDraft({
    ownerId: 'owner-1', idempotencyKey: 'same-key', request: { prompt: 'draft' },
    provider: 'deepseek', budgetUsd: 0.1, maxOutputTokens: 1200,
  })
  assert.equal(run.id, 'fixed-run-id')
  assert.match(captured.text, /UNIQUE|ON CONFLICT \(owner_id, idempotency_key\)/)
  assert.match(captured.text, /WHERE agent_runs\.request_fingerprint = EXCLUDED\.request_fingerprint/)
  assert.equal(captured.values[2], 'same-key')
  assert.match(captured.values[3], /^[a-f0-9]{64}$/)
})

test('request nonce is claimed by a unique insert after expired rows are removed', async () => {
  const statements = []
  const pool = {
    async query(text, values) {
      statements.push({ text, values })
      return text.startsWith('INSERT') ? { rowCount: 1, rows: [{ nonce: values[0] }] } : { rowCount: 0, rows: [] }
    },
  }
  const store = new PostgresStore(pool)
  const expiresAt = new Date(Date.now() + 60_000)
  assert.equal(await store.consumeRequestNonce('00112233445566778899aabbccddeeff', expiresAt), true)
  assert.match(statements[0].text, /DELETE FROM agent_request_nonces WHERE expires_at <= now\(\)/)
  assert.match(statements[1].text, /ON CONFLICT \(nonce\) DO NOTHING RETURNING nonce/)
  assert.equal(statements[1].values[1], expiresAt)
})

test('worker claim uses SKIP LOCKED, monotonic lease epoch, and active lease fencing', async () => {
  const statements = []
  const client = {
    async query(text) {
      statements.push(text)
      if (text.includes('WITH candidate')) return { rowCount: 1, rows: [dbRunRow()] }
      return { rowCount: 1, rows: [] }
    },
    release() {},
  }
  const store = new PostgresStore({ connect: async () => client })
  const claim = await store.claimNext('worker-once-id', 120_000)
  assert.equal(claim.run.id, 'fixed-run-id')
  assert.equal(claim.leaseEpoch, 7)
  assert.match(statements.find((statement) => statement.includes('WITH candidate')), /FOR UPDATE SKIP LOCKED/)
  assert.match(statements.find((statement) => statement.includes('WITH candidate')), /lease_epoch=r\.lease_epoch\+1/)

  let startedSql = ''
  const fencedStore = new PostgresStore({ async query(text) { startedSql = text; return { rowCount: 0, rows: [] } } })
  assert.equal(await fencedStore.markProviderStarted('fixed-run-id', 6), false)
  assert.match(startedSql, /lease_epoch=\$2/)
  assert.match(startedSql, /lease_expires_at > \$3/)
})

test('result write is rejected after lease expiry or a newer fencing epoch', async () => {
  let resultSql = ''
  const client = {
    async query(text) {
      if (text.includes('UPDATE agent_runs SET state=$3')) {
        resultSql = text
        return { rowCount: 0, rows: [] }
      }
      return { rowCount: 0, rows: [] }
    },
    release() {},
  }
  const pool = {
    async connect() { return client },
  }
  const store = new PostgresStore(pool)
  const accepted = await store.finishClaim('fixed-run-id', 6, { state: 'succeeded', finishedAt: new Date() })
  assert.equal(accepted, false)
  assert.match(resultSql, /lease_epoch=\$2/)
  assert.match(resultSql, /lease_expires_at > \$9/)
})

test('terminal run state and event are committed in one transaction', async () => {
  const statements = []
  const client = {
    async query(text) {
      statements.push(text)
      if (text.startsWith('UPDATE agent_runs SET state=$3')) return { rowCount: 1, rows: [] }
      return { rowCount: 1, rows: [] }
    },
    release() { statements.push('RELEASE') },
  }
  const store = new PostgresStore({ connect: async () => client })
  assert.equal(await store.finishClaim('fixed-run-id', 7, { state: 'succeeded' }), true)
  assert.equal(statements.length, 5)
  assert.equal(statements[0], 'BEGIN')
  assert.match(statements[1], /^UPDATE agent_runs SET state=/)
  assert.match(statements[2], /^INSERT INTO agent_run_events/)
  assert.equal(statements[3], 'COMMIT')
  assert.equal(statements[4], 'RELEASE')
})

test('event insertion failure rolls back the terminal state update', async () => {
  const statements = []
  const client = {
    async query(text) {
      statements.push(text)
      if (text.startsWith('UPDATE agent_runs SET state=$3')) return { rowCount: 1, rows: [] }
      if (text.startsWith('INSERT INTO agent_run_events')) throw new Error('simulated event insert failure')
      return { rowCount: 0, rows: [] }
    },
    release() { statements.push('RELEASE') },
  }
  const store = new PostgresStore({ connect: async () => client })
  await assert.rejects(store.finishClaim('fixed-run-id', 7, { state: 'succeeded' }), /simulated event insert failure/)
  assert.equal(statements[0], 'BEGIN')
  assert.match(statements[1], /^UPDATE agent_runs SET state=/)
  assert.match(statements[2], /^INSERT INTO agent_run_events/)
  assert.equal(statements[3], 'ROLLBACK')
  assert.equal(statements[4], 'RELEASE')
})
