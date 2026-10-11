import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { approvalFingerprint } from './approval.js'
import { configuredModel, configuredRates } from './providers.js'

export function createHttpHandler({
  store,
  serviceToken,
  subjectSigningSecret = process.env.WORKSPACE_SUBJECT_SIGNING_SECRET,
  env = process.env,
  maxBudgetUsd = 1,
  maxOutputTokens = 4096,
}) {
  return async (request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json; charset=utf-8')
    try {
      const url = new URL(request.url, 'http://agent-service.local')
      if (url.pathname === '/v1/health' && request.method === 'GET') {
        const taskTrigger = await store.hasRecentWorkerHeartbeat?.() ? 'approved_worker' : 'not_configured'
        return send(response, 200, {
          status: 'ok', persistence: 'postgres',
          taskTrigger,
          providers: {
            deepseek: providerReady('deepseek', env),
            openai: providerReady('openai', env),
          },
        })
      }
      if (!authorized(request.headers.authorization, serviceToken)) return send(response, 401, { error: 'UNAUTHORIZED' })
      const rawBody = await readRawBody(request)
      const requestTarget = `${url.pathname}${url.search}`
      const verified = verifiedWorkspaceSubject(request.headers, {
        secret: subjectSigningSecret,
        method: request.method,
        requestTarget,
        body: rawBody,
      })
      const ownerId = verified?.ownerId
      if (!ownerId) return send(response, 401, { error: 'UNAUTHORIZED' })
      const nonceExpiresAt = new Date(Math.max(Date.now(), Number(verified.timestamp)) + 120_000)
      if (!await store.consumeRequestNonce(verified.nonce, nonceExpiresAt)) {
        return send(response, 401, { error: 'UNAUTHORIZED' })
      }

      if (url.pathname === '/v1/runs' && request.method === 'POST') {
        const body = parseJsonBody(rawBody)
        if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 20_000) {
          return send(response, 400, { error: 'INVALID_PROMPT' })
        }
        const provider = body.provider ?? 'deepseek'
        if (!['deepseek', 'openai'].includes(provider)) return send(response, 400, { error: 'UNSUPPORTED_PROVIDER' })
        const model = configuredModel(provider, env)
        const budgetUsd = Number(body.budgetUsd ?? 0.1)
        const requestedTokens = Number(body.maxOutputTokens ?? 1200)
        if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > maxBudgetUsd) {
          return send(response, 400, { error: 'BUDGET_OUT_OF_RANGE', maxBudgetUsd })
        }
        if (!Number.isInteger(requestedTokens) || requestedTokens < 1 || requestedTokens > maxOutputTokens) {
          return send(response, 400, { error: 'OUTPUT_LIMIT_OUT_OF_RANGE', maxOutputTokens })
        }
        const idempotencyKey = String(request.headers['idempotency-key'] ?? '')
        if (!idempotencyKey || idempotencyKey.length > 160) return send(response, 400, { error: 'IDEMPOTENCY_KEY_REQUIRED' })
        const run = await store.createDraft({
          ownerId, idempotencyKey, request: { prompt: body.prompt.trim() }, provider, model, budgetUsd,
          maxOutputTokens: requestedTokens,
        })
        return send(response, 201, { run, approvalFingerprint: approvalFingerprint(run) })
      }
      if (url.pathname === '/v1/runs' && request.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const runs = await store.listRuns(ownerId, limit)
        return send(response, 200, { runs: runs.map(withApprovalFingerprint) })
      }

      const match = url.pathname.match(/^\/v1\/runs\/([0-9a-f-]+)(?:\/(approve|cancel|events))?$/i)
      if (!match) return send(response, 404, { error: 'NOT_FOUND' })
      const [, runId, action] = match
      if (!action && request.method === 'GET') {
        const run = await store.getRun(runId, ownerId)
        return run ? send(response, 200, { run: withApprovalFingerprint(run) }) : send(response, 404, { error: 'NOT_FOUND' })
      }
      if (!action && request.method === 'PATCH') {
        const current = await store.getRun(runId, ownerId)
        if (!current) return send(response, 404, { error: 'NOT_FOUND' })
        const body = parseJsonBody(rawBody)
        const prompt = body.prompt === undefined ? current.request.prompt : body.prompt
        const provider = body.provider ?? current.provider
        const model = configuredModel(provider, env)
        const budgetUsd = Number(body.budgetUsd ?? current.budgetUsd)
        const tokens = Number(body.maxOutputTokens ?? current.maxOutputTokens)
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20_000) return send(response, 400, { error: 'INVALID_PROMPT' })
        if (!['deepseek', 'openai'].includes(provider)) return send(response, 400, { error: 'UNSUPPORTED_PROVIDER' })
        if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > maxBudgetUsd) return send(response, 400, { error: 'BUDGET_OUT_OF_RANGE', maxBudgetUsd })
        if (!Number.isInteger(tokens) || tokens < 1 || tokens > maxOutputTokens) return send(response, 400, { error: 'OUTPUT_LIMIT_OUT_OF_RANGE', maxOutputTokens })
        const run = await store.editDraft({
          runId, ownerId, expectedVersion: Number(body.version), request: { prompt: prompt.trim() },
          provider, model, budgetUsd, maxOutputTokens: tokens,
        })
        if (!run) return send(response, 409, { error: 'RUN_VERSION_CONFLICT_OR_NOT_EDITABLE' })
        return send(response, 200, { run, approvalFingerprint: approvalFingerprint(run) })
      }
      if (action === 'events' && request.method === 'GET') {
        const events = await store.events(runId, ownerId)
        return send(response, 200, { events })
      }
      if (action === 'approve' && request.method === 'POST') {
        const pending = await store.getRun(runId, ownerId)
        if (!pending) return send(response, 404, { error: 'RUN_NOT_FOUND' })
        if (!providerReady(pending.provider, env)) return send(response, 503, { error: 'PROVIDER_NOT_CONFIGURED' })
        if (!await store.hasRecentWorkerHeartbeat?.()) return send(response, 503, { error: 'TASK_TRIGGER_NOT_CONFIGURED' })
        const body = parseJsonBody(rawBody)
        const run = await store.approveAndQueue({
          runId, ownerId, version: Number(body.version),
          fingerprint: String(body.approvalFingerprint ?? ''), confirmedOpenAI: body.confirmedOpenAI === true,
        })
        return send(response, 202, { run })
      }
      if (action === 'cancel' && request.method === 'POST') {
        const run = await store.cancel(runId, ownerId)
        return run ? send(response, 202, { run }) : send(response, 404, { error: 'NOT_FOUND_OR_NOT_CANCELLABLE' })
      }
      return send(response, 405, { error: 'METHOD_NOT_ALLOWED' })
    } catch (error) {
      const known = new Set(['RUN_NOT_FOUND', 'RUN_VERSION_CONFLICT', 'APPROVAL_SNAPSHOT_MISMATCH', 'OPENAI_CONFIRMATION_REQUIRED', 'IDEMPOTENCY_KEY_REUSED'])
      const badRequest = error instanceof SyntaxError || error.message === 'BODY_TOO_LARGE'
      const status = known.has(error.message) ? (error.message === 'RUN_NOT_FOUND' ? 404 : 409) : badRequest ? 400 : 500
      const code = known.has(error.message) ? error.message : error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : badRequest ? 'INVALID_JSON' : 'INTERNAL_ERROR'
      return send(response, status, { error: code })
    }
  }
}

// The bridge signs the owner and complete request envelope with a server-only secret.
// The plain subject header is only an identifier; it is never an authority.
export function signWorkspaceSubject({ subject, timestamp, nonce, method, requestTarget, idempotencyKey = '', body }, secret) {
  const bodyDigest = createHash('sha256').update(body).digest('hex')
  const canonical = JSON.stringify([
    timestamp, nonce, subject, method.toUpperCase(), requestTarget, idempotencyKey, bodyDigest,
  ])
  return createHmac('sha256', secret).update(canonical).digest('hex')
}

function verifiedWorkspaceSubject(headers, { secret, method, requestTarget, body }, now = Date.now()) {
  const subject = String(headers['x-workspace-subject'] ?? '')
  const timestamp = String(headers['x-workspace-subject-timestamp'] ?? '')
  const nonce = String(headers['x-workspace-subject-nonce'] ?? '')
  const signature = String(headers['x-workspace-subject-signature'] ?? '')
  if (!secret || !subject || subject.length > 160 || /[\r\n]/.test(subject) || !/^\d{13}$/.test(timestamp)
    || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return null
  if (Math.abs(now - Number(timestamp)) > 60_000) return null
  const expected = Buffer.from(signWorkspaceSubject({
    subject, timestamp, nonce, method, requestTarget,
    idempotencyKey: String(headers['idempotency-key'] ?? ''), body,
  }, secret), 'hex')
  const supplied = Buffer.from(signature, 'hex')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? { ownerId: subject, timestamp, nonce }
    : null
}

function authorized(header = '', token = '') {
  const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(token)
  return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function readRawBody(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += bytes.length
    if (length > 32_000) throw new Error('BODY_TOO_LARGE')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

function parseJsonBody(input) {
  return JSON.parse(input.toString('utf8') || '{}')
}

function send(response, status, body) {
  response.writeHead(status)
  response.end(JSON.stringify(body))
}

function withApprovalFingerprint(run) {
  return { ...run, approvalFingerprint: run.state === 'draft' ? approvalFingerprint(run) : null }
}

function providerReady(provider, env) {
  const keyName = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'
  try {
    configuredRates(provider, env)
    return Boolean(env[keyName])
  } catch {
    return false
  }
}
