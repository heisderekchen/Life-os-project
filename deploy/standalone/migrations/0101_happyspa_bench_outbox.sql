-- Private-workbench only. This table stores accepted read-only observations;
-- it never stores promotion credentials or issues advertising commands.
CREATE TABLE IF NOT EXISTS happyspa_bench_outbox (
  event_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('official_snapshot','neo_heartbeat','plan_confirmation')),
  observed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_happyspa_bench_outbox_kind_observed
  ON happyspa_bench_outbox(kind, observed_at DESC);
