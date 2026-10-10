import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { approvalFingerprint } from '../src/approval.js'
import { createHttpHandler, signWorkspaceSubject } from '../src/http.js'

// Deliberately in-memory HTTP tests. They validate the service contract only;
// they do not claim PostgreSQL persistence or a real provider execution.
function fakeStore({ workerReady = false } = {}) {
  const runs = new Map()
  const requestNonces = new Set()
  let seq = 0
  return {
    async hasRecentWorkerHeartbeat() { return workerReady },
    async consumeRequestNonce(nonce) {
      if (requestNonces.has(nonce)) return false
      requestNonces.add(nonce)
      return true
    },
    async createDraft(input) {
      const run = {
        id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        ...input, model: input.model || (input.provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'),
        budgetUsd: String(input.budgetUsd), maxOutputTokens: input.maxOutputTokens,
        version: 1, state: 'draft', dataScope: { mode: 'user_input_only' }, approval: null,
      }
      runs.set(run.id, run)
      return run
    },
    async getRun(id, owner) { const run = runs.get(id); return run?.ownerId === owner ? run : null },
    async listRuns(owner) { return [...runs.values()].filter((run) => run.ownerId === owner) },
    async editDraft(input) {
      const run = await this.getRun(input.runId, input.ownerId)
      if (!run || run.state !== 'draft' || run.version !== input.expectedVersion) return null
      Object.assign(run, {
        request: input.request, provider: input.provider,
        model: input.model || (input.provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'),
        budgetUsd: String(input.budgetUsd), maxOutputTokens: input.maxOutputTokens,
        version: run.version + 1,
      })
      return run
    },
    async approveAndQueue(input) {
      const run = await this.getRun(input.runId, input.ownerId)
      if (!run) throw new Error('RUN_NOT_FOUND')
      if (run.version !== input.version) throw new Error('RUN_VERSION_CONFLICT')
      if (approvalFingerprint(run) !== input.fingerprint) throw new Error('APPROVAL_SNAPSHOT_MISMATCH')
      if (run.provider === 'openai' && !input.confirmedOpenAI) throw new Error('OPENAI_CONFIRMATION_REQUIRED')
      run.approval = { version: run.version, fingerprint: input.fingerprint, confirmedOpenAI: input.confirmedOpenAI }
      run.state = 'queued'
      return run
    },
    async cancel(id, owner) { const run = await this.getRun(id, owner); if (run) run.state = 'cancelled'; return run },
    async events(id, owner) { return await this.getRun(id, owner) ? [] : [] },
  }
}

const subjectSigningSecret = 'test-only-subject-signing-secret'

async function withService(fn, { signingSecret = subjectSigningSecret, extraEnv = {} } = {}) {
  const store = fakeStore({ workerReady: extraEnv.AGENT_TASK_TRIGGER === 'approved_worker' })
  const handler = createHttpHandler({
    store, serviceToken: 'test-only-server-token', maxBudgetUsd: 0.5,
    env: { DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', ...extraEnv },
    subjectSigningSecret: signingSecret,
  })
  const invoke = async (url, { method = 'GET', headers: requestHeaders = {}, body = '', autoSign = true } = {}) => {
    const signedHeaders = { ...requestHeaders }
    if (autoSign && signedHeaders['x-workspace-subject'] && !signedHeaders['x-workspace-subject-signature']) {
      const timestamp = String(Date.now())
      const nonce = randomBytes(16).toString('hex')
      const parsedUrl = new URL(url, 'http://agent-service.local')
      signedHeaders['x-workspace-subject-timestamp'] = timestamp
      signedHeaders['x-workspace-subject-nonce'] = nonce
      signedHeaders['x-workspace-subject-signature'] = signWorkspaceSubject({
        subject: signedHeaders['x-workspace-subject'], timestamp, nonce, method,
        requestTarget: parsedUrl.pathname + parsedUrl.search,
        idempotencyKey: String(signedHeaders['idempotency-key'] ?? ''),
        body: Buffer.from(body),
      }, subjectSigningSecret)
    }
    const request = {
      url, method, headers: signedHeaders,
      async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) },
    }
    const result = { headers: {}, status: 200, body: '' }
    const response = {
      setHeader(name, value) { result.headers[name] = value },
      writeHead(status) { result.status = status },
      end(payload) { result.body = payload },
    }
    await handler(request, response)
    return { status: result.status, headers: result.headers, json: () => JSON.parse(result.body) }
  }
  await fn(invoke)
}

const subject = 'owner-test'
const headers = {
  authorization: 'Bearer test-only-server-token',
  'x-workspace-subject': subject,
  'content-type': 'application/json',
  'idempotency-key': 'request-001',
}

test('unauthenticated request cannot create a run; health reveals no credentials', async () => {
  await withService(async (invoke) => {
    const denied = await invoke('/v1/runs', { method: 'POST', body: JSON.stringify({ prompt: 'x' }) })
    assert.equal(denied.status, 401)
    const health = await invoke('/v1/health').then((response) => response.json())
    assert.deepEqual(health, {
      status: 'ok', persistence: 'postgres', taskTrigger: 'not_configured',
      providers: { deepseek: false, openai: false },
    })
  })
})

test('workspace owner requires a valid, fresh bridge signature and fails closed without signing config', async () => {
  await withService(async (invoke) => {
    const unsigned = await invoke('/v1/runs', {
      method: 'POST', headers: {
        authorization: headers.authorization,
        'x-workspace-subject': 'victim-owner',
        'idempotency-key': 'unsigned',
      }, body: JSON.stringify({ prompt: 'must not create' }), autoSign: false,
    })
    assert.equal(unsigned.status, 401)

    const tamperedBody = JSON.stringify({ prompt: 'must not create' })
    const tamperedTimestamp = String(Date.now())
    const tamperedNonce = randomBytes(16).toString('hex')
    const tampered = await invoke('/v1/runs', {
      method: 'POST', headers: {
        ...headers,
        'x-workspace-subject': 'victim-owner',
        'x-workspace-subject-timestamp': tamperedTimestamp,
        'x-workspace-subject-nonce': tamperedNonce,
        'x-workspace-subject-signature': signWorkspaceSubject({
          subject, timestamp: tamperedTimestamp, nonce: tamperedNonce, method: 'POST', requestTarget: '/v1/runs',
          idempotencyKey: String(headers['idempotency-key']),
          body: Buffer.from(tamperedBody),
        }, subjectSigningSecret),
      }, body: tamperedBody, autoSign: false,
    })
    assert.equal(tampered.status, 401)

    const staleTimestamp = String(Date.now() - 61_000)
    const staleNonce = randomBytes(16).toString('hex')
    const staleBody = JSON.stringify({ prompt: 'must not create' })
    const stale = await invoke('/v1/runs', {
      method: 'POST', headers: {
        ...headers,
        'x-workspace-subject-timestamp': staleTimestamp,
        'x-workspace-subject-nonce': staleNonce,
        'x-workspace-subject-signature': signWorkspaceSubject({
          subject, timestamp: staleTimestamp, nonce: staleNonce, method: 'POST', requestTarget: '/v1/runs',
          idempotencyKey: String(headers['idempotency-key']),
          body: Buffer.from(staleBody),
        }, subjectSigningSecret),
      }, body: staleBody,
    })
    assert.equal(stale.status, 401)
  })

  await withService(async (invoke) => {
    const response = await invoke('/v1/runs', {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'must fail closed' }),
    })
    assert.equal(response.status, 401)
  }, { signingSecret: '' })
})

test('signature binds method, target, and body; nonce can be consumed only once', async () => {
  await withService(async (invoke) => {
    const body = JSON.stringify({ prompt: 'signed payload' })
    const timestamp = String(Date.now())
    const nonce = randomBytes(16).toString('hex')
    const signature = signWorkspaceSubject({
      subject, timestamp, nonce, method: 'POST', requestTarget: '/v1/runs', idempotencyKey: String(headers['idempotency-key']), body: Buffer.from(body),
    }, subjectSigningSecret)
    const signed = {
      ...headers,
      'x-workspace-subject-timestamp': timestamp,
      'x-workspace-subject-nonce': nonce,
      'x-workspace-subject-signature': signature,
    }
    assert.equal((await invoke('/v1/runs', { method: 'POST', headers: signed, body })).status, 201)
    assert.equal((await invoke('/v1/runs', { method: 'POST', headers: signed, body })).status, 401)

    const boundNonce = randomBytes(16).toString('hex')
    const boundSignature = signWorkspaceSubject({
      subject, timestamp, nonce: boundNonce, method: 'POST', requestTarget: '/v1/runs', idempotencyKey: String(headers['idempotency-key']), body: Buffer.from(body),
    }, subjectSigningSecret)
    const bound = { ...headers, 'x-workspace-subject-timestamp': timestamp,
      'x-workspace-subject-nonce': boundNonce, 'x-workspace-subject-signature': boundSignature }
    assert.equal((await invoke('/v1/runs?limit=1', { method: 'POST', headers: bound, body })).status, 401)
    assert.equal((await invoke('/v1/runs', { method: 'PATCH', headers: bound, body })).status, 401)
    assert.equal((await invoke('/v1/runs', { method: 'POST', headers: bound, body: JSON.stringify({ prompt: 'changed' }) })).status, 401)
    assert.equal((await invoke('/v1/runs', { method: 'POST', headers: { ...bound, 'idempotency-key': 'changed-key' }, body })).status, 401)
  })
})

test('creates an explicitly pending DeepSeek draft with approval fingerprint', async () => {
  await withService(async (invoke) => {
    const response = await invoke('/v1/runs', {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'Draft a read-only report', budgetUsd: 0.2 }),
    })
    assert.equal(response.status, 201)
    const { run, approvalFingerprint: fingerprint } = response.json()
    assert.equal(run.state, 'draft')
    assert.equal(run.provider, 'deepseek')
    assert.equal(run.dataScope.mode, 'user_input_only')
    assert.equal(typeof fingerprint, 'string')
  })
})

test('draft records the configured provider model', async () => {
  await withService(async (invoke) => {
    const response = await invoke('/v1/runs', {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'Synthetic model selection check' }),
    })
    assert.equal(response.status, 201)
    assert.equal(response.json().run.model, 'deepseek-v4-pro')
  }, { extraEnv: { DEEPSEEK_MODEL: 'deepseek-v4-pro' } })
})

test('owner can reload persistent run list after leaving the client', async () => {
  await withService(async (invoke) => {
    await invoke('/v1/runs', {
      method: 'POST', headers, body: JSON.stringify({ prompt: 'persist this draft' }),
    })
    const list = await invoke('/v1/runs?limit=50', { headers })
    assert.equal(list.status, 200)
    assert.equal(list.json().runs.length, 1)
    assert.equal(list.json().runs[0].request.prompt, 'persist this draft')
  })
})

test('OpenAI requires confirmation and approval snapshot must match exact draft', async () => {
  await withService(async (invoke) => {
    const created = await invoke('/v1/runs', {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'request-002' },
      body: JSON.stringify({ prompt: 'draft', provider: 'openai' }),
    }).then((response) => response.json())
    const approve = (fingerprint, confirmedOpenAI) => invoke(`/v1/runs/${created.run.id}/approve`, {
      method: 'POST', headers,
      body: JSON.stringify({ version: created.run.version, approvalFingerprint: fingerprint, confirmedOpenAI }),
    })
    assert.equal((await approve(created.approvalFingerprint, false)).status, 409)
    assert.equal((await approve('tampered', true)).status, 409)
    const accepted = await approve(created.approvalFingerprint, true)
    assert.equal(accepted.status, 202)
    assert.equal(accepted.json().run.state, 'queued')
  }, { extraEnv: {
    AGENT_TASK_TRIGGER: 'approved_worker',
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    DEEPSEEK_INPUT_USD_PER_MILLION: '1',
    DEEPSEEK_OUTPUT_USD_PER_MILLION: '1',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_INPUT_USD_PER_MILLION: '1',
    OPENAI_OUTPUT_USD_PER_MILLION: '1',
  } })
})

test('application budget and token caps reject oversized requests before queueing', async () => {
  await withService(async (invoke) => {
    const response = await invoke('/v1/runs', {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'request-003' },
      body: JSON.stringify({ prompt: 'x', budgetUsd: 0.6, maxOutputTokens: 1200 }),
    })
    assert.equal(response.status, 400)
    assert.equal(response.json().error, 'BUDGET_OUT_OF_RANGE')
  })
})

test('editing a draft changes its version and invalidates the prior approval fingerprint', async () => {
  await withService(async (invoke) => {
    const created = await invoke('/v1/runs', {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'request-004' },
      body: JSON.stringify({ prompt: 'first version' }),
    }).then((response) => response.json())
    const edited = await invoke(`/v1/runs/${created.run.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ version: created.run.version, prompt: 'updated version' }),
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.json().run.version, created.run.version + 1)
    assert.notEqual(edited.json().approvalFingerprint, created.approvalFingerprint)
    const stale = await invoke(`/v1/runs/${created.run.id}/approve`, {
      method: 'POST', headers,
      body: JSON.stringify({ version: created.run.version, approvalFingerprint: created.approvalFingerprint }),
    })
    assert.equal(stale.status, 409)
  }, { extraEnv: {
    AGENT_TASK_TRIGGER: 'approved_worker',
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    DEEPSEEK_INPUT_USD_PER_MILLION: '1',
    DEEPSEEK_OUTPUT_USD_PER_MILLION: '1',
  } })
})

test('approval fails closed until provider pricing and a live task worker are ready', async () => {
  await withService(async (invoke) => {
    const created = await invoke('/v1/runs', {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'trigger-not-ready' },
      body: JSON.stringify({ prompt: 'a private task' }),
    }).then((response) => response.json())
    const approve = () => invoke(`/v1/runs/${created.run.id}/approve`, {
      method: 'POST', headers,
      body: JSON.stringify({ version: created.run.version, approvalFingerprint: created.approvalFingerprint }),
    })
    assert.equal((await approve()).status, 503)
    assert.equal((await approve()).json().error, 'TASK_TRIGGER_NOT_CONFIGURED')
  }, { extraEnv: {
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    DEEPSEEK_INPUT_USD_PER_MILLION: '1',
    DEEPSEEK_OUTPUT_USD_PER_MILLION: '1',
  } })

  await withService(async (invoke) => {
    const created = await invoke('/v1/runs', {
      method: 'POST', headers: { ...headers, 'idempotency-key': 'provider-not-ready' },
      body: JSON.stringify({ prompt: 'a private task' }),
    }).then((response) => response.json())
    const response = await invoke(`/v1/runs/${created.run.id}/approve`, {
      method: 'POST', headers,
      body: JSON.stringify({ version: created.run.version, approvalFingerprint: created.approvalFingerprint }),
    })
    assert.equal(response.status, 503)
    assert.equal(response.json().error, 'PROVIDER_NOT_CONFIGURED')
  }, { extraEnv: { AGENT_TASK_TRIGGER: 'approved_worker' } })
})
