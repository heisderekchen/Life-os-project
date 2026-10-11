#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PostgresStore } from '../src/postgres-store.js'
import { createHttpHandler, signWorkspaceSubject } from '../src/http.js'
import { callProvider, configuredModel } from '../src/providers.js'
import { createTimeoutBoundProviderCall, executeClaim } from '../src/runner.js'
import { providerSmokeFailureSummary } from '../src/provider-smoke-summary.js'

const PGLITE_VERSION = '0.5.8'
const MAX_ALLOWED_TOKENS = 128
const MAX_ALLOWED_BUDGET_USD = 0.01
const SYNTHETIC_PROMPT = [
  'Synthetic connectivity check only.',
  'Return JSON with a short summary and exactly one draft.',
  'Use the title "Synthetic follow-up", a brief description, and low priority.',
  'Do not refer to real people, customers, or business data.',
].join(' ')

async function main() {
const options = parseArgs(process.argv.slice(2))
if ((options.testFailReopenCheck || options.testFailRunReadback) && !options.offlineTest) {
  fail('TEST_FAILURE_MODE_REQUIRES_OFFLINE')
}
if (options.help) {
  printHelp()
  return
}

const provider = options.provider ?? 'deepseek'
if (!['deepseek', 'openai'].includes(provider)) fail('INVALID_PROVIDER')
const keyName = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'
const ratePrefix = provider === 'deepseek' ? 'DEEPSEEK' : 'OPENAI'
const modelName = provider === 'deepseek' ? 'DEEPSEEK_MODEL' : 'OPENAI_MODEL'
const tokenLimit = parseBoundedInteger(options.maxOutputTokens ?? '128', 1, MAX_ALLOWED_TOKENS, 'INVALID_TOKEN_LIMIT')
const budgetUsd = parseBoundedNumber(options.budgetUsd ?? '0.01', 0, MAX_ALLOWED_BUDGET_USD, 'INVALID_BUDGET')
const hasApiKey = options.offlineTest ? false : Boolean(process.env[keyName])
const hasInputRate = validPositiveNumber(process.env[`${ratePrefix}_INPUT_USD_PER_MILLION`])
const hasOutputRate = validPositiveNumber(process.env[`${ratePrefix}_OUTPUT_USD_PER_MILLION`])
const ready = options.offlineTest || (hasApiKey && hasInputRate && hasOutputRate)

if (!options.execute && !options.offlineTest) {
  output({
    mode: 'dry-run',
    provider,
    modelOverridePresent: Boolean(process.env[modelName] || options.model),
    apiKeyPresent: hasApiKey,
    inputRatePresent: hasInputRate,
    outputRatePresent: hasOutputRate,
    outputTokenCeiling: tokenLimit,
    budgetCeilingUsd: budgetUsd,
    database: `PGlite ${PGLITE_VERSION} file-backed PostgreSQL-compatible WASM, temporary local fixture`,
    wouldCallProvider: false,
    ready,
  })
  if (!ready) process.exitCode = 2
  return
}

if (!ready) {
  output({ mode: 'synthetic-real-provider', outcome: 'blocked', errorCode: 'PREFLIGHT_NOT_READY', secretsPrinted: false })
  process.exitCode = 2
  return
}

let database
let databaseDirectory
let providerCalls = 0
let providerHttpRequests = 0
let providerOutcome = 'not_started'
let providerErrorCode = null
try {
  databaseDirectory = await mkdtemp(join(tmpdir(), 'lifeos-agent-provider-smoke-'))
  database = new PGlite(databaseDirectory)
  const pool = createPGlitePool(database)
  const store = new PostgresStore(pool)
  if (options.testFailRunReadback) {
    const originalGetRun = store.getRun.bind(store)
    store.getRun = async (...args) => {
      if (providerOutcome === 'succeeded') throw new Error('DATABASE_READ_FAILED')
      return originalGetRun(...args)
    }
  }
  const serviceToken = randomBytes(32).toString('hex')
  const subjectSigningSecret = randomBytes(32).toString('hex')
  const ownerId = 'synthetic-provider-smoke'
  const defaultModel = provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'
  const env = options.offlineTest
    ? {
        [modelName]: options.model || defaultModel,
        [`${ratePrefix}_INPUT_USD_PER_MILLION`]: process.env[`${ratePrefix}_INPUT_USD_PER_MILLION`] || '0.30',
        [`${ratePrefix}_OUTPUT_USD_PER_MILLION`]: process.env[`${ratePrefix}_OUTPUT_USD_PER_MILLION`] || '1.20',
      }
    : {
        ...process.env,
        [modelName]: options.model || process.env[modelName] || defaultModel,
      }
  const model = configuredModel(provider, env)
  const handler = createHttpHandler({
    store,
    serviceToken,
    subjectSigningSecret,
    env,
    maxBudgetUsd: MAX_ALLOWED_BUDGET_USD,
    maxOutputTokens: MAX_ALLOWED_TOKENS,
  })
  await store.migrate()

  const created = await invoke(handler, serviceToken, subjectSigningSecret, ownerId, '/v1/runs', 'POST', {
    prompt: SYNTHETIC_PROMPT,
    provider,
    budgetUsd,
    maxOutputTokens: tokenLimit,
  })
  if (created.status !== 201) fail('RUN_CREATE_FAILED')
  const run = created.body.run
  const approved = await store.approveAndQueue({
    runId: run.id,
    ownerId,
    version: run.version,
    fingerprint: created.body.approvalFingerprint,
    confirmedOpenAI: provider === 'openai',
  })
  if (approved.state !== 'queued') fail('APPROVAL_FIXTURE_FAILED')
  const claim = await store.claimNext('synthetic-smoke-worker', 120_000)
  if (!claim || claim.run.id !== run.id) fail('CLAIM_FIXTURE_FAILED')

  const smokeMode = options.offlineTest ? 'synthetic-offline-fixture' : 'synthetic-real-provider'
  // One invocation only. The provider adapter has no automatic retry path.
  const outcome = await executeClaim(claim, store, {
    env,
    providerCall: createTimeoutBoundProviderCall((request, { signal } = {}) => {
      providerCalls += 1
      if (options.offlineTest) {
        return Promise.resolve({
          text: JSON.stringify({
            summary: 'offline synthetic fixture',
            drafts: [{ title: 'Synthetic follow-up', description: 'Offline persistence check', priority: 'low' }],
          }),
          providerRunId: 'offline-fixture',
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        })
      }
      return callProvider(request, {
        env,
        signal,
        fetchImpl: (input, init) => {
          providerHttpRequests += 1
          return fetch(input, init)
        },
      })
    }, 50_000),
  })
  providerOutcome = outcome.outcome
  const persistedBeforeClose = await store.getRun(run.id, ownerId)
  providerErrorCode = persistedBeforeClose?.errorCode ?? null
  const expectedHttpRequests = options.offlineTest ? 0 : 1
  if (providerCalls !== 1 || providerHttpRequests !== expectedHttpRequests) fail('PROVIDER_CALL_COUNT_MISMATCH')
  if (outcome.outcome !== 'succeeded'
    || persistedBeforeClose?.state !== 'succeeded'
    || persistedBeforeClose.result?.drafts?.length !== 1
    || !persistedBeforeClose.usage?.totalTokens) {
    fail('RESULT_VALIDATION_FAILED')
  }

  await database.close()
  database = null
  database = new PGlite(databaseDirectory)
  if (options.testFailReopenCheck) {
    await database.query("UPDATE agent_runs SET state='failed' WHERE id=$1", [run.id])
  }
  const persisted = await database.query(
    'SELECT state,provider,model,usage,result FROM agent_runs WHERE id=$1',
    [run.id],
  )
  const reopenedEvents = await database.query(
    'SELECT event_type FROM agent_run_events WHERE run_id=$1 ORDER BY id',
    [run.id],
  )
  const reopenedEventTypes = reopenedEvents.rows.map((event) => event.event_type)
  const row = persisted.rows[0]
  if (!row
    || row.state !== 'succeeded'
    || row.provider !== provider
    || row.model !== model
    || row.result?.drafts?.length !== 1
    || !row.usage?.totalTokens
    || JSON.stringify(reopenedEventTypes) !== JSON.stringify(['approved', 'succeeded'])) {
    fail('REOPEN_PERSISTENCE_FAILED')
  }

  output({
    mode: smokeMode,
    provider,
    model,
    outcome: row.state,
    inputTokens: row.usage.inputTokens,
    outputTokens: row.usage.outputTokens,
    totalTokens: row.usage.totalTokens,
    persistedDraftCount: row.result.drafts.length,
    persistedAfterDatabaseReopen: true,
    eventTypes: reopenedEventTypes,
    estimatedCostUsd: outcome.estimatedCostUsd,
    database: `PGlite ${PGLITE_VERSION} file-backed PostgreSQL-compatible WASM, temporary local fixture`,
    providerCalls,
    providerHttpRequests,
    automaticRetries: 0,
    apiKeyValuePrinted: false,
    providerNetworkAccess: !options.offlineTest,
    requestContentPrinted: false,
  })
} catch (error) {
  output(providerSmokeFailureSummary({
    mode: options.offlineTest ? 'synthetic-offline-fixture' : 'synthetic-real-provider',
    providerOutcome,
    errorCode: providerOutcome === 'uncertain' && providerErrorCode ? providerErrorCode : error?.message,
    providerCalls,
    providerHttpRequests,
  }))
  process.exitCode = 1
} finally {
  try { await database?.close() } catch {}
  if (databaseDirectory) {
    try { await rm(databaseDirectory, { recursive: true, force: true }) } catch {}
  }
}
}

function createPGlitePool(db) {
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params.map((value) => (
      value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)
        ? JSON.stringify(value)
        : value
    )))
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 }
  }
  return {
    query,
    async connect() {
      return { query, release() {} }
    },
  }
}

async function invoke(handler, serviceToken, signingSecret, ownerId, path, method, bodyObject = {}) {
  const url = new URL(path, 'http://agent-service.local')
  const body = JSON.stringify(bodyObject)
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('hex')
  const idempotencyKey = method === 'POST' && path === '/v1/runs' ? randomBytes(16).toString('hex') : ''
  const headers = {
    authorization: `Bearer ${serviceToken}`,
    'x-workspace-subject': ownerId,
    'x-workspace-subject-timestamp': timestamp,
    'x-workspace-subject-nonce': nonce,
    'idempotency-key': idempotencyKey,
    'x-workspace-subject-signature': signWorkspaceSubject({
      subject: ownerId,
      timestamp,
      nonce,
      method,
      requestTarget: url.pathname + url.search,
      idempotencyKey,
      body: Buffer.from(body),
    }, signingSecret),
  }
  const request = {
    url: path,
    method,
    headers,
    async *[Symbol.asyncIterator]() { if (body.length) yield Buffer.from(body) },
  }
  const responseState = { status: 200, body: '' }
  const response = {
    setHeader() {},
    writeHead(status) { responseState.status = status },
    end(text) { responseState.body = text },
  }
  await handler(request, response)
  return { status: responseState.status, body: JSON.parse(responseState.body) }
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') parsed.execute = true
    else if (arg === '--offline-test') parsed.offlineTest = true
    else if (arg === '--test-fail-reopen-check') parsed.testFailReopenCheck = true
    else if (arg === '--test-fail-run-readback') parsed.testFailRunReadback = true
    else if (arg === '--help' || arg === '-h') parsed.help = true
    else if (['--provider', '--model', '--max-output-tokens', '--budget-usd'].includes(arg)) {
      const key = {
        '--provider': 'provider',
        '--model': 'model',
        '--max-output-tokens': 'maxOutputTokens',
        '--budget-usd': 'budgetUsd',
      }[arg]
      if (!args[index + 1] || args[index + 1].startsWith('--')) fail('INVALID_ARGUMENTS')
      parsed[key] = args[index + 1]
      index += 1
    } else fail('INVALID_ARGUMENTS')
  }
  return parsed
}

function parseBoundedInteger(value, min, max, error) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) fail(error)
  return number
}

function parseBoundedNumber(value, minExclusive, max, error) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= minExclusive || number > max) fail(error)
  return number
}

function validPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function fail(code) {
  const safeCode = /^[A-Z0-9_:-]{1,64}$/.test(code) ? code : 'SMOKE_FAILED'
  throw new Error(safeCode)
}

function printHelp() {
  process.stdout.write([
    'Usage: npm run smoke:provider -- [--execute|--offline-test] [--provider deepseek|openai] [--model MODEL]',
    '       [--max-output-tokens 1..128] [--budget-usd 0<value<=0.01]',
    'Default is dry-run: prints config presence only and never calls a provider.',
    '--offline-test runs the full local PGlite persistence check with a fake provider and no network.',
    '--test-fail-reopen-check simulates a reopened-result failure; requires --offline-test.',
    '--test-fail-run-readback simulates a post-provider database read failure; offline only.',
    '--execute makes exactly one synthetic provider request. It uses a fresh temporary',
    'PGlite file database, random in-process service/signing credentials, then verifies',
    'persistence after reopen and removes the temporary database.',
  ].join('\n') + '\n')
}

main().catch((error) => {
  const safeCode = /^[A-Z0-9_:-]{1,64}$/.test(String(error?.message)) ? error.message : 'SMOKE_FAILED'
  output({ outcome: 'blocked', errorCode: safeCode, secretsPrinted: false })
  process.exitCode = 1
})
