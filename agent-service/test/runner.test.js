import test from 'node:test'
import assert from 'node:assert/strict'
import { approvalFingerprint, assertApproval } from '../src/approval.js'
import { createTimeoutBoundProviderCall, executeClaim } from '../src/runner.js'

function sampleRun(overrides = {}) {
  return {
    id: 'run-1', ownerId: 'owner-1', version: 2,
    request: { prompt: 'Prepare a read-only weekly report outline' },
    provider: 'deepseek', model: 'deepseek-flash', budgetUsd: '0.10',
    maxOutputTokens: 500, dataScope: { mode: 'user_input_only' },
    ...overrides,
  }
}

function mockStore() {
  const calls = []
  return {
    calls,
    async markProviderStarted(...args) { calls.push(['started', ...args]); return true },
    async finishClaim(...args) { calls.push(['finished', ...args]); return true },
  }
}

const testRates = {
  DEEPSEEK_INPUT_USD_PER_MILLION: '1',
  DEEPSEEK_OUTPUT_USD_PER_MILLION: '1',
  OPENAI_INPUT_USD_PER_MILLION: '1',
  OPENAI_OUTPUT_USD_PER_MILLION: '1',
}

test('approval is bound to version, provider, budget, token cap and data scope', () => {
  const run = sampleRun()
  const approval = { version: run.version, fingerprint: approvalFingerprint(run) }
  assert.doesNotThrow(() => assertApproval(run, approval))
  assert.throws(() => assertApproval({ ...run, budgetUsd: '0.50' }, approval), /APPROVAL_SNAPSHOT_MISMATCH/)
  assert.throws(() => assertApproval({ ...run, provider: 'openai' }, approval), /APPROVAL_SNAPSHOT_MISMATCH/)
  assert.throws(() => assertApproval(sampleRun({ provider: 'openai' }), {
    version: 2, fingerprint: approvalFingerprint(sampleRun({ provider: 'openai' })),
  }), /OPENAI_CONFIRMATION_REQUIRED/)
})

test('runner persists an editable proposal, provider run id and usage from a mocked provider', async () => {
  const store = mockStore()
  const run = sampleRun()
  const claim = { run, leaseEpoch: 9, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  const response = await executeClaim(claim, store, {
    env: testRates,
    providerCall: async (args) => {
      assert.equal(args.provider, 'deepseek')
      assert.ok(args.maxOutputTokens <= run.maxOutputTokens)
      return {
        text: JSON.stringify({ summary: 'Draft only', drafts: [{ title: 'Review', description: 'Check trends', priority: 'medium' }] }),
        providerRunId: 'mock-provider-run-123',
        usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
      }
    },
  })
  assert.deepEqual(response, {
    outcome: 'succeeded', providerRunId: 'mock-provider-run-123',
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
    estimatedCostUsd: 0.00013,
  })
  const finalWrite = store.calls.at(-1)[3]
  assert.equal(finalWrite.state, 'succeeded')
  assert.equal(finalWrite.providerRunId, 'mock-provider-run-123')
  assert.equal(finalWrite.usage.totalTokens, 130)
  assert.equal(finalWrite.result.drafts[0].title, 'Review')
})

test('provider timeout becomes uncertain and is never retried automatically', async () => {
  const store = mockStore()
  const run = sampleRun()
  const claim = { run, leaseEpoch: 4, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  let calls = 0
  const response = await executeClaim(claim, store, {
    env: testRates,
    providerCall: async () => {
      calls += 1
      const error = new TypeError('connection reset')
      throw error
    },
  })
  assert.equal(response.outcome, 'uncertain')
  assert.equal(calls, 1)
  assert.equal(store.calls.at(-1)[3].state, 'uncertain')
})

test('timeout-bound provider call passes the signal in options and persists TimeoutError as uncertain', async () => {
  const captured = []
  const call = createTimeoutBoundProviderCall(async (request, options) => {
    captured.push({ request, options })
    throw new DOMException('The operation timed out', 'TimeoutError')
  }, 50_000)
  const store = mockStore()
  const run = sampleRun()
  const claim = { run, leaseEpoch: 5, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  const result = await executeClaim(claim, store, { env: testRates, providerCall: call })
  assert.equal(captured.length, 1)
  assert.equal(captured[0].options.signal instanceof AbortSignal, true)
  assert.equal(captured[0].options.signal.aborted, false)
  assert.equal(result.outcome, 'uncertain')
  assert.equal(store.calls.at(-1)[3].state, 'uncertain')
})

test('application budget cap blocks provider call when estimated input consumes budget', async () => {
  const store = mockStore()
  const run = sampleRun({ budgetUsd: '0.000001', request: { prompt: 'x'.repeat(1000) } })
  const claim = { run, leaseEpoch: 1, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  let calls = 0
  const response = await executeClaim(claim, store, { env: testRates, providerCall: async () => { calls += 1 } })
  assert.equal(response.outcome, 'failed')
  assert.equal(calls, 0)
  assert.equal(store.calls.at(-1)[3].errorCode, 'BUDGET_TOO_LOW_FOR_REQUEST')
})

test('stale worker lease cannot invoke a provider', async () => {
  const store = mockStore()
  store.markProviderStarted = async () => false
  const run = sampleRun()
  const claim = { run, leaseEpoch: 2, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  let calls = 0
  const response = await executeClaim(claim, store, { env: testRates, providerCall: async () => { calls += 1 } })
  assert.equal(response.outcome, 'stale_lease')
  assert.equal(calls, 0)
})

test('missing provider pricing profile fails honestly before any provider request', async () => {
  const store = mockStore()
  const run = sampleRun()
  const claim = { run, leaseEpoch: 2, approval: { version: run.version, fingerprint: approvalFingerprint(run) } }
  let calls = 0
  const response = await executeClaim(claim, store, { env: {}, providerCall: async () => { calls += 1 } })
  assert.equal(response.outcome, 'failed')
  assert.equal(calls, 0)
  assert.equal(store.calls.at(-1)[3].errorCode, 'PROVIDER_PRICING_NOT_CONFIGURED')
})
