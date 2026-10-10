CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  request jsonb NOT NULL,
  provider text NOT NULL CHECK (provider IN ('deepseek', 'openai')),
  model text NOT NULL,
  budget_usd numeric(12,6) NOT NULL CHECK (budget_usd > 0),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 8192),
  data_scope jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  state text NOT NULL CHECK (state IN ('draft','queued','running','cancel_requested','uncertain','succeeded','failed','budget_exceeded','cancelled')),
  approval jsonb,
  lease_epoch bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_started_at timestamptz,
  provider_run_id text,
  usage jsonb,
  estimated_cost_usd numeric(12,8),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS agent_runs_claim_idx
  ON agent_runs(state, created_at) WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS agent_run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  safe_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_request_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_request_nonces_expires_idx
  ON agent_request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS agent_worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
