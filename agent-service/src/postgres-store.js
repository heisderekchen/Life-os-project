import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { approvalFingerprint } from './approval.js'

const schemaPath = new URL('../sql/schema.sql', import.meta.url)

export class PostgresStore {
  constructor(pool) {
    this.pool = pool
  }

  async migrate() {
    const schema = await readFile(fileURLToPath(schemaPath), 'utf8')
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
      await this.pool.query(statement)
    }
  }

  async consumeRequestNonce(nonce, expiresAt) {
    await this.pool.query('DELETE FROM agent_request_nonces WHERE expires_at <= now()')
    const result = await this.pool.query(
      'INSERT INTO agent_request_nonces(nonce,expires_at) VALUES ($1,$2) ON CONFLICT (nonce) DO NOTHING RETURNING nonce',
      [nonce, expiresAt],
    )
    return result.rowCount === 1
  }

  async createDraft({ ownerId, idempotencyKey, request, provider = 'deepseek', model, budgetUsd, maxOutputTokens = 1200 }) {
    const id = randomUUID()
    model ||= provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'
    const requestFingerprint = createHash('sha256').update(JSON.stringify({ request, provider, budgetUsd, maxOutputTokens })).digest('hex')
    const result = await this.pool.query(
      `INSERT INTO agent_runs
        (id, owner_id, idempotency_key, request_fingerprint, request, provider, model, budget_usd, max_output_tokens, data_scope, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft')
       ON CONFLICT (owner_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         WHERE agent_runs.request_fingerprint = EXCLUDED.request_fingerprint
       RETURNING *`,
      [id, ownerId, idempotencyKey, requestFingerprint, request, provider, model, budgetUsd, maxOutputTokens, { mode: 'user_input_only' }],
    )
    if (!result.rowCount) throw new Error('IDEMPOTENCY_KEY_REUSED')
    return rowToRun(result.rows[0])
  }

  async editDraft({ runId, ownerId, expectedVersion, request, provider, model, budgetUsd, maxOutputTokens }) {
    const result = await this.pool.query(
      `UPDATE agent_runs SET request=$4, provider=$5, model=$6, budget_usd=$7,
         max_output_tokens=$8, version=version+1, approval=NULL, updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND version=$3 AND state='draft' RETURNING *`,
      [runId, ownerId, expectedVersion, request, provider, model || (provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini'), budgetUsd, maxOutputTokens],
    )
    return result.rowCount ? rowToRun(result.rows[0]) : null
  }

  async getRun(runId, ownerId) {
    const result = await this.pool.query('SELECT * FROM agent_runs WHERE id=$1 AND owner_id=$2', [runId, ownerId])
    return result.rowCount ? rowToRun(result.rows[0]) : null
  }

  async listRuns(ownerId, limit = 50) {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 100))
    const result = await this.pool.query(
      'SELECT * FROM agent_runs WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT $2',
      [ownerId, boundedLimit],
    )
    return result.rows.map(rowToRun)
  }

  async approveAndQueue({ runId, ownerId, version, fingerprint, confirmedOpenAI }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query('SELECT * FROM agent_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE', [runId, ownerId])
      if (!selected.rowCount) throw new Error('RUN_NOT_FOUND')
      const run = rowToRun(selected.rows[0])
      if (run.state !== 'draft' || run.version !== version) throw new Error('RUN_VERSION_CONFLICT')
      if (approvalFingerprint(run) !== fingerprint) throw new Error('APPROVAL_SNAPSHOT_MISMATCH')
      if (run.provider === 'openai' && confirmedOpenAI !== true) throw new Error('OPENAI_CONFIRMATION_REQUIRED')
      const approval = { version, fingerprint, confirmedOpenAI: confirmedOpenAI === true, approvedAt: new Date().toISOString() }
      const updated = await client.query(
        `UPDATE agent_runs SET state='queued', approval=$2::jsonb, updated_at=now()
         WHERE id=$1 AND state='draft' RETURNING *`, [runId, approval],
      )
      await client.query(
        `INSERT INTO agent_run_events(run_id,event_type,safe_detail) VALUES ($1,'approved',jsonb_build_object('provider',$2::text,'version',$3::integer))`,
        [runId, run.provider, run.version],
      )
      await client.query('COMMIT')
      return rowToRun(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async claimNext(workerId, leaseMs = 60_000) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE agent_runs SET state='uncertain', error_code='LEASE_EXPIRED_AFTER_PROVIDER_START', updated_at=now()
         WHERE state IN ('running','cancel_requested') AND provider_started_at IS NOT NULL
           AND lease_expires_at < now()`,
      )
      await client.query(
        `UPDATE agent_runs SET state='queued', lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
         WHERE state='running' AND provider_started_at IS NULL AND lease_expires_at < now()`,
      )
      const result = await client.query(
        `WITH candidate AS (
           SELECT id FROM agent_runs WHERE state='queued'
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE agent_runs r SET state='running', lease_epoch=r.lease_epoch+1,
           lease_owner=$1, lease_expires_at=now()+($2 * interval '1 millisecond'), updated_at=now()
         FROM candidate c WHERE r.id=c.id RETURNING r.*`, [workerId, leaseMs],
      )
      await client.query('COMMIT')
      if (!result.rowCount) return null
      const run = rowToRun(result.rows[0])
      return { run, approval: run.approval, leaseEpoch: Number(result.rows[0].lease_epoch) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async markProviderStarted(runId, leaseEpoch, startedAt = new Date()) {
    const result = await this.pool.query(
      `UPDATE agent_runs SET provider_started_at=$3, updated_at=$3
       WHERE id=$1 AND lease_epoch=$2 AND state='running' AND provider_started_at IS NULL AND lease_expires_at > $3`,
      [runId, leaseEpoch, startedAt],
    )
    return result.rowCount === 1
  }

  async finishClaim(runId, leaseEpoch, outcome) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE agent_runs SET state=$3, provider_run_id=$4, usage=$5, estimated_cost_usd=$6,
           result=$7, error_code=$8, lease_owner=NULL, lease_expires_at=NULL, updated_at=$9
         WHERE id=$1 AND lease_epoch=$2 AND state IN ('running','cancel_requested') AND lease_expires_at > $9`,
        [runId, leaseEpoch, outcome.state, outcome.providerRunId ?? null, outcome.usage ?? null,
          outcome.estimatedCostUsd ?? null, outcome.result ?? null, outcome.errorCode ?? null, outcome.finishedAt ?? new Date()],
      )
      if (result.rowCount !== 1) {
        await client.query('COMMIT')
        return false
      }
      await client.query(
        `INSERT INTO agent_run_events(run_id,event_type,safe_detail) VALUES ($1,$2,$3)`,
        [runId, outcome.state, { providerRunId: outcome.providerRunId ?? null, usage: outcome.usage ?? null }],
      )
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async recordWorkerHeartbeat(workerId) {
    await this.pool.query(
      `INSERT INTO agent_worker_heartbeats(worker_id,last_seen_at) VALUES ($1,now())
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at=now()`,
      [workerId],
    )
  }

  async hasRecentWorkerHeartbeat() {
    const result = await this.pool.query(
      "SELECT EXISTS(SELECT 1 FROM agent_worker_heartbeats WHERE last_seen_at > now() - interval '30 seconds') AS ready",
    )
    return result.rows[0]?.ready === true
  }

  async cancel(runId, ownerId) {
    const result = await this.pool.query(
      `UPDATE agent_runs SET state=CASE
         WHEN state IN ('draft','queued') THEN 'cancelled'
         WHEN state='running' AND provider_started_at IS NULL THEN 'cancelled'
         WHEN state='running' AND provider_started_at IS NOT NULL THEN 'cancel_requested'
         ELSE state END,
       lease_owner=CASE WHEN state='running' AND provider_started_at IS NULL THEN NULL ELSE lease_owner END,
       lease_expires_at=CASE WHEN state='running' AND provider_started_at IS NULL THEN NULL ELSE lease_expires_at END,
       updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND state IN ('draft','queued','running') RETURNING *`, [runId, ownerId],
    )
    return result.rowCount ? rowToRun(result.rows[0]) : null
  }

  async events(runId, ownerId) {
    const result = await this.pool.query(
      `SELECT e.event_type,e.safe_detail,e.created_at FROM agent_run_events e
       JOIN agent_runs r ON r.id=e.run_id WHERE e.run_id=$1 AND r.owner_id=$2 ORDER BY e.id`,
      [runId, ownerId],
    )
    return result.rows
  }
}

function rowToRun(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key,
    request: row.request,
    provider: row.provider,
    model: row.model,
    budgetUsd: String(row.budget_usd),
    maxOutputTokens: row.max_output_tokens,
    dataScope: row.data_scope,
    version: row.version,
    state: row.state,
    approval: row.approval,
    leaseEpoch: Number(row.lease_epoch),
    providerRunId: row.provider_run_id,
    usage: row.usage,
    estimatedCostUsd: row.estimated_cost_usd,
    result: row.result,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
