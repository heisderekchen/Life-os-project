export const HAPPYSPA_BENCH_CONTRACT_VERSION = '2026-10-20.v1'
export const HAPPYSPA_BENCH_TASK_ID = '499537ec-0aec-4a2e-8b1a-5526c9864d66'
export const HAPPYSPA_BENCH_FRESHNESS_MS = 10 * 60 * 1000
const OUTBOX_KINDS = ['official_snapshot', 'neo_heartbeat', 'plan_confirmation']

export function snapshotState(observedAt, now = Date.now()) {
  if (!observedAt) return 'pending_confirmation'
  const timestamp = Date.parse(observedAt)
  if (Number.isNaN(timestamp)) return 'failed'
  return now - timestamp > HAPPYSPA_BENCH_FRESHNESS_MS ? 'stale' : 'fresh'
}

// Used by the authorized local outbox bridge. The WHERE clause makes retried
// or older observations a no-op, so accepted state can only advance in time.
export function outboxUpsertStatement(record, acceptedAt) {
  if (!OUTBOX_KINDS.includes(record.kind)) throw new Error('unsupported outbox kind')
  if (!record.eventId || !record.observedAt) throw new Error('eventId and observedAt are required')
  return {
    sql: `INSERT INTO happyspa_bench_outbox (event_id,kind,observed_at,payload_json,accepted_at)
      VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET kind=excluded.kind, observed_at=excluded.observed_at,
      payload_json=excluded.payload_json, accepted_at=excluded.accepted_at
      WHERE excluded.observed_at > happyspa_bench_outbox.observed_at`,
    params: [record.eventId, record.kind, record.observedAt, JSON.stringify(record.payload ?? {}), acceptedAt],
  }
}

function validTime(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
function validFen(value) { return value === null || (Number.isInteger(value) && value >= 0) }
function validBusinessDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
export function validateOutboxRecord(value) {
  if (!value || value.contractVersion !== HAPPYSPA_BENCH_CONTRACT_VERSION || value.producer !== 'neo-happyspa-readonly' || value.taskId !== HAPPYSPA_BENCH_TASK_ID) return 'invalid envelope'
  if (!OUTBOX_KINDS.includes(value.kind) || typeof value.eventId !== 'string' || !value.eventId || !validTime(value.observedAt) || !value.payload || typeof value.payload !== 'object') return 'invalid event'
  if (value.kind === 'official_snapshot' && (!validFen(value.payload.todaySpendFen) || (value.payload.sourceAsOf !== null && !validTime(value.payload.sourceAsOf)))) return 'invalid official snapshot'
  if (value.kind === 'neo_heartbeat' && (typeof value.payload.serviceState !== 'string' || !validTime(value.payload.lastSuccessfulReadAt))) return 'invalid heartbeat'
  if (value.kind === 'plan_confirmation' && (!validBusinessDate(value.payload.businessDate) || !validFen(value.payload.accountDailyBudgetFen) || !validFen(value.payload.platformCapFen) || !Array.isArray(value.payload.intervals))) return 'invalid plan confirmation'
  return null
}
export async function acceptOutboxRecord(request, env, acceptedAt = new Date().toISOString()) {
  const record = await request.json().catch(() => null)
  const error = validateOutboxRecord(record)
  if (error) return { status: 400, body: { error } }
  const statement = outboxUpsertStatement(record, acceptedAt)
  await env.DB.prepare(statement.sql).bind(...statement.params).run()
  return { status: 202, body: { eventId: record.eventId, acceptedAt } }
}

function baseSnapshot() {
  return {
    contractVersion: HAPPYSPA_BENCH_CONTRACT_VERSION, taskId: HAPPYSPA_BENCH_TASK_ID,
    timezone: 'Asia/Shanghai', integration: 'local_outbox_not_connected',
    plan: { date: '2026-10-20', accountDailyBudgetFen: 12000, platformCapFen: 20000, planId: '极速推广20260512557', planType: '极速推', intervals: [
      { label: '00:00–10:00', targetCumulativeFen: 0 }, { label: '10:00–12:00', targetCumulativeFen: 2500 }, { label: '12:00–15:00', targetCumulativeFen: 6500 },
      { label: '15:00–18:00', targetCumulativeFen: 8000 }, { label: '18:00–21:00', targetCumulativeFen: 12000 },
      { label: '21:00–24:00', targetCumulativeFen: 12000, stopped: true },
    ] },
    live: { official: { state: 'pending_confirmation', observedAt: null, sourceAsOf: null, todaySpendFen: null }, neo: { state: 'pending_confirmation', observedAt: null }, planEffective: { state: 'pending_confirmation', observedAt: null } },
    historicalObservation: { observedAt: '2026-10-20T10:16:16+08:00', summary: 'S7.52，完整 9 个 running；仅历史观察，不代表当前状态。', sourceAsOf: null },
    evidence: [{ kind: 'screenshot', reference: 'exec-f6c0c5c4-a839-46ee-8a4d-862297794181.png', confidence: 'historical' }, { kind: 'history', reference: 'daily-prep-2026-10-20.json', confidence: 'historical' }],
  }
}

// The ordering is intentionally by source observation time, rather than
// delivery time: a delayed older event must never regress the displayed state.
export const latestOutboxByKindStatement = `SELECT event_id, kind, observed_at, payload_json, accepted_at
  FROM happyspa_bench_outbox WHERE kind = ? ORDER BY observed_at DESC, accepted_at DESC LIMIT 1`

function parsedOutboxRow(row) {
  if (!row || !OUTBOX_KINDS.includes(row.kind) || !validTime(row.observed_at)) return null
  try {
    const payload = JSON.parse(row.payload_json)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return { ...row, payload }
  } catch { return null }
}

// Read-only metadata. It does not use any browser, credential, or controller.
// A failed/missing storage lookup deliberately returns the explicit unconnected
// state instead of reusing an old value or claiming a live integration.
export async function happySpaBenchSnapshot(env = null, now = Date.now()) {
  const snapshot = baseSnapshot()
  if (!env?.DB) return snapshot
  try {
    const rows = await Promise.all(OUTBOX_KINDS.map(async kind => parsedOutboxRow(
      await env.DB.prepare(latestOutboxByKindStatement).bind(kind).first(),
    )))
    const [official, neo, plan] = rows
    if (!official && !neo && !plan) return snapshot
    snapshot.integration = 'local_outbox_connected'
    if (official) snapshot.live.official = {
      state: snapshotState(official.observed_at, now), observedAt: official.observed_at,
      sourceAsOf: official.payload.sourceAsOf ?? null, todaySpendFen: official.payload.todaySpendFen ?? null,
    }
    if (neo) snapshot.live.neo = { state: snapshotState(neo.observed_at, now), observedAt: neo.observed_at }
    if (plan) snapshot.live.planEffective = { state: snapshotState(plan.observed_at, now), observedAt: plan.observed_at }
    return snapshot
  } catch { return snapshot }
}
