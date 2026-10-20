import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { acceptOutboxRecord, happySpaBenchSnapshot, latestOutboxByKindStatement, outboxUpsertStatement, snapshotState } from '../src/happyspa-bench.mjs'
import { createD1Sqlite } from '../d1-sqlite.mjs'
import { handlePersonalWorkbench } from '../src/personal-workbench.mjs'

const snapshot = await happySpaBenchSnapshot()
assert.equal(snapshot.integration, 'local_outbox_not_connected')
assert.equal(snapshot.live.official.todaySpendFen, null)
assert.equal(snapshot.live.official.sourceAsOf, null)
assert.equal(snapshot.live.neo.state, 'pending_confirmation')
assert.equal(snapshot.plan.accountDailyBudgetFen, 12000)
assert.deepEqual(snapshot.plan.intervals.map(item => item.targetCumulativeFen), [0, 2500, 6500, 8000, 12000, 12000])
assert.equal(snapshot.plan.intervals.at(-1).stopped, true)
assert.match(snapshot.historicalObservation.summary, /仅历史观察/)
assert.equal(snapshot.historicalObservation.sourceAsOf, null)

const request = new Request('https://local/api/personal-workbench/lifeos/happyspa-bench/snapshot')
const authorized = await handlePersonalWorkbench(request, {}, new URL(request.url), {
  username: 'owner', role: 'personal-workbench', scope: 'personal-workbench',
})
assert.equal(authorized.status, 200)
assert.equal((await authorized.json()).taskId, snapshot.taskId)
const denied = await handlePersonalWorkbench(request, {}, new URL(request.url), {})
assert.equal(denied.status, 404)
assert.equal(snapshotState(null), 'pending_confirmation')
assert.equal(snapshotState('not-a-time'), 'failed')
assert.equal(snapshotState('2026-10-20T10:00:00+08:00', Date.parse('2026-10-20T10:05:00+08:00')), 'fresh')
assert.equal(snapshotState('2026-10-20T10:00:00+08:00', Date.parse('2026-10-20T10:11:00+08:00')), 'stale')
const upsert = outboxUpsertStatement({ eventId: 'evt-1', kind: 'neo_heartbeat', observedAt: '2026-10-20T10:00:00+08:00', payload: { status: 'ok' } }, '2026-10-20T10:00:01+08:00')
assert.match(upsert.sql, /WHERE excluded\.observed_at > happyspa_bench_outbox\.observed_at/)
assert.equal(upsert.params[0], 'evt-1')
const runs = []
const fakeEnv = { DB: { prepare: sql => ({ bind: (...params) => ({ run: async () => runs.push({ sql, params }) }) }) } }
const good = { contractVersion: '2026-10-20.v1', producer: 'neo-happyspa-readonly', taskId: '499537ec-0aec-4a2e-8b1a-5526c9864d66', eventId: 'evt-2', kind: 'official_snapshot', observedAt: '2026-10-20T10:00:00+08:00', payload: { todaySpendFen: null, sourceAsOf: null } }
const accepted = await acceptOutboxRecord(new Request('https://local', { method: 'POST', body: JSON.stringify(good) }), fakeEnv, '2026-10-20T10:00:01+08:00')
assert.equal(accepted.status, 202); assert.equal(runs.length, 1)
const rejected = await acceptOutboxRecord(new Request('https://local', { method: 'POST', body: JSON.stringify({ ...good, producer: 'wrong' }) }), fakeEnv)
assert.equal(rejected.status, 400); assert.equal(runs.length, 1)

// This is an actual SQLite migration/upsert check, not a string assertion.
// It covers both retry IDs and delayed events with new IDs: latest state is
// always selected by source observed_at, so delivery order cannot regress it.
const sqlite = new DatabaseSync(':memory:')
sqlite.exec(readFileSync(new URL('../migrations/0101_happyspa_bench_outbox.sql', import.meta.url), 'utf8'))
const db = createD1Sqlite(sqlite)
const put = (eventId, observedAt, todaySpendFen) => {
  const statement = outboxUpsertStatement({ eventId, kind: 'official_snapshot', observedAt, payload: { todaySpendFen, sourceAsOf: null } }, '2026-10-20T03:00:00.000Z')
  return db.prepare(statement.sql).bind(...statement.params).run()
}
put('evt-duplicate', '2026-10-20T10:00:00+08:00', 100)
put('evt-duplicate', '2026-10-20T09:00:00+08:00', 50)
assert.equal(sqlite.prepare('SELECT payload_json FROM happyspa_bench_outbox WHERE event_id = ?').get('evt-duplicate').payload_json.includes('100'), true)
put('evt-delayed-new-id', '2026-10-20T08:00:00+08:00', 40)
put('evt-newest', '2026-10-20T11:00:00+08:00', 200)
put('evt-even-older-new-id', '2026-10-20T07:00:00+08:00', 20)
const latest = sqlite.prepare(latestOutboxByKindStatement).get('official_snapshot')
assert.equal(latest.event_id, 'evt-newest')
const connected = await happySpaBenchSnapshot({ DB: db }, Date.parse('2026-10-20T11:05:00+08:00'))
assert.equal(connected.integration, 'local_outbox_connected')
assert.equal(connected.live.official.todaySpendFen, 200)
assert.equal(connected.live.official.state, 'fresh')
console.log('HappyspaBench read-only snapshot contract: OK')
