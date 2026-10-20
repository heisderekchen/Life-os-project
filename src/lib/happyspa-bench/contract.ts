export const HAPPYSPA_BENCH_CONTRACT_VERSION = '2026-10-20.v1' as const
export const HAPPYSPA_BENCH_TASK_ID = '499537ec-0aec-4a2e-8b1a-5526c9864d66' as const

export type SnapshotState = 'pending_confirmation' | 'fresh' | 'stale' | 'failed' | 'unavailable'

// Amounts are integer fen. Null means the collector has not confirmed a value.
export interface HappySpaBenchOutboxRecord {
  contractVersion: typeof HAPPYSPA_BENCH_CONTRACT_VERSION
  producer: 'neo-happyspa-readonly'
  taskId: typeof HAPPYSPA_BENCH_TASK_ID
  eventId: string
  kind: 'official_snapshot' | 'neo_heartbeat' | 'plan_confirmation'
  observedAt: string
  payload: unknown
}

export interface HappySpaBenchSnapshot {
  contractVersion: typeof HAPPYSPA_BENCH_CONTRACT_VERSION
  taskId: typeof HAPPYSPA_BENCH_TASK_ID
  timezone: 'Asia/Shanghai'
  integration: 'local_outbox_not_connected' | 'local_outbox_connected'
  plan: { date: string; accountDailyBudgetFen: number; platformCapFen: number; planId: string; planType: '极速推'; intervals: Array<{ label: string; targetCumulativeFen: number; stopped?: boolean }> }
  live: { official: { state: SnapshotState; observedAt: string | null; sourceAsOf: string | null; todaySpendFen: number | null }; neo: { state: SnapshotState; observedAt: string | null }; planEffective: { state: SnapshotState; observedAt: string | null } }
  historicalObservation: { observedAt: string; summary: string; sourceAsOf: null }
  evidence: Array<{ kind: 'screenshot' | 'history'; reference: string; confidence: 'historical' | 'declared' }>
}
