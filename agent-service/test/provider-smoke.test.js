import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { providerSmokeFailureSummary } from '../src/provider-smoke-summary.js'

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = resolve(serviceRoot, 'scripts/provider-smoke.mjs')

test('provider smoke defaults to a no-call preflight and never prints environment values', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: serviceRoot,
    env: {
      PATH: process.env.PATH,
      DEEPSEEK_API_KEY: 'SYNTHETIC_SENTINEL_KEY',
      DEEPSEEK_INPUT_USD_PER_MILLION: '0.30',
      DEEPSEEK_OUTPUT_USD_PER_MILLION: '1.20',
      DEEPSEEK_MODEL: 'synthetic-model-override',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.mode, 'dry-run')
  assert.equal(output.wouldCallProvider, false)
  assert.equal(output.ready, true)
  assert.equal(output.apiKeyPresent, true)
  assert.equal(output.inputRatePresent, true)
  assert.equal(output.outputRatePresent, true)
  assert.equal(output.modelOverridePresent, true)
  assert.equal(result.stdout.includes('SYNTHETIC_SENTINEL_KEY'), false)
  assert.equal(result.stdout.includes('synthetic-model-override'), false)
  assert.equal(result.stderr, '')
})

test('execute mode blocks before database or provider work when configuration is incomplete', () => {
  const result = spawnSync(process.execPath, [script, '--execute'], {
    cwd: serviceRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.outcome, 'blocked')
  assert.equal(output.errorCode, 'PREFLIGHT_NOT_READY')
  assert.equal(output.secretsPrinted, false)
})

test('offline fixture verifies reopened rows and events without a provider request', () => {
  const result = spawnSync(process.execPath, [script, '--offline-test'], {
    cwd: serviceRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.mode, 'synthetic-offline-fixture')
  assert.equal(output.outcome, 'succeeded')
  assert.equal(output.persistedAfterDatabaseReopen, true)
  assert.equal(output.persistedDraftCount, 1)
  assert.deepEqual(output.eventTypes, ['approved', 'succeeded'])
  assert.equal(output.providerCalls, 1)
  assert.equal(output.providerHttpRequests, 0)
  assert.equal(output.providerNetworkAccess, false)
  assert.equal(output.apiKeyValuePrinted, false)
})

test('offline reopen failure reports failed smoke separately from succeeded provider outcome', () => {
  const result = spawnSync(process.execPath, [script, '--offline-test', '--test-fail-reopen-check'], {
    cwd: serviceRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.mode, 'synthetic-offline-fixture')
  assert.equal(output.outcome, 'failed')
  assert.equal(output.providerOutcome, 'succeeded')
  assert.equal(output.errorCode, 'REOPEN_PERSISTENCE_FAILED')
  assert.equal(output.providerCalls, 1)
  assert.equal(output.providerHttpRequests, 0)
  assert.equal(output.secretsPrinted, false)
})

test('offline provider success followed by run-read failure keeps overall smoke failed', () => {
  const result = spawnSync(process.execPath, [script, '--offline-test', '--test-fail-run-readback'], {
    cwd: serviceRoot,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  const output = JSON.parse(result.stdout)
  assert.equal(output.mode, 'synthetic-offline-fixture')
  assert.equal(output.outcome, 'failed')
  assert.equal(output.providerOutcome, 'succeeded')
  assert.equal(output.errorCode, 'DATABASE_READ_FAILED')
  assert.equal(output.providerCalls, 1)
  assert.equal(output.providerHttpRequests, 0)
})

test('provider smoke enforces hard output and estimated-budget ceilings', () => {
  for (const args of [
    ['--max-output-tokens', '129'],
    ['--budget-usd', '0.0101'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: serviceRoot,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    const output = JSON.parse(result.stdout)
    assert.equal(output.outcome, 'blocked')
    assert.equal(output.secretsPrinted, false)
  }
})

test('smoke failure summary preserves uncertain outcomes and observed call counts only', () => {
  const summary = providerSmokeFailureSummary({
    mode: 'synthetic-real-provider',
    providerOutcome: 'uncertain',
    errorCode: 'TimeoutError',
    providerCalls: 1,
    providerHttpRequests: 1,
    apiKey: 'SYNTHETIC_SENTINEL_KEY',
    providerRunId: 'private-provider-id',
  })
  assert.deepEqual(summary, {
    mode: 'synthetic-real-provider',
    outcome: 'failed',
    providerOutcome: 'uncertain',
    errorCode: 'PROVIDER_TIMEOUT',
    providerCalls: 1,
    providerHttpRequests: 1,
    automaticRetries: 0,
    secretsPrinted: false,
  })
  assert.equal(JSON.stringify(summary).includes('SYNTHETIC_SENTINEL_KEY'), false)
  assert.equal(JSON.stringify(summary).includes('private-provider-id'), false)
  const networkFailure = providerSmokeFailureSummary({
    mode: 'synthetic-real-provider',
    providerOutcome: 'not_started',
    errorCode: 'DATABASE_READ_FAILED',
    providerCalls: 1,
    providerHttpRequests: 1,
  })
  assert.equal(networkFailure.outcome, 'failed')
  assert.equal(networkFailure.providerOutcome, 'uncertain')
  assert.equal(networkFailure.errorCode, 'DATABASE_READ_FAILED')
})
