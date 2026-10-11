# Portable Life OS agent service

This is an independent Node.js + PostgreSQL service. It has no Cloudflare
runtime or package dependency and can run on a managed Node/container platform with a
managed PostgreSQL database. It has not been deployed or connected to Life OS.

The worker produces editable task proposals only. It has no code-execution
tools, business API credentials, or access to HappySpa operational data. The
first data scope is user-entered text. A server-side Life OS bridge and a
reviewed hosting environment are still required before a browser session can
submit or read runs.

## Runtime configuration

Required: `DATABASE_URL`, `AGENT_SERVICE_TOKEN`, `WORKSPACE_SUBJECT_SIGNING_SECRET`, `DEEPSEEK_API_KEY`, and current
provider price settings `DEEPSEEK_INPUT_USD_PER_MILLION` and
`DEEPSEEK_OUTPUT_USD_PER_MILLION`. The DeepSeek default model is
`deepseek-flash` and can be overridden with `DEEPSEEK_MODEL`; OpenAI defaults
to `gpt-4.1-mini` and can be overridden with `OPENAI_MODEL`. Confirm available
model IDs against the provider account before enabling execution. OpenAI escalation additionally requires
`OPENAI_API_KEY`, `OPENAI_INPUT_USD_PER_MILLION`, and
`OPENAI_OUTPUT_USD_PER_MILLION`. Price values are operator configuration and
must be checked against the provider's current official pricing before enabling
execution. The API refuses to call a provider if that provider's price profile
is absent. Keep service/provider credentials server-side; never expose them to
the Life OS browser bundle.

The Life OS bridge must provide `x-workspace-subject`,
`x-workspace-subject-timestamp` (Unix milliseconds),
`x-workspace-subject-nonce` (32 lowercase hex characters), and
`x-workspace-subject-signature` (lowercase hex HMAC-SHA256 using
`WORKSPACE_SUBJECT_SIGNING_SECRET`). The HMAC input is the UTF-8 JSON array of
`<timestamp>`, `<nonce>`, `<subject>`, uppercase HTTP method, exact path and
query, `Idempotency-Key` value (or an empty string), and the lowercase SHA-256
digest of the raw request body, in that order. The service rejects timestamps
more than 60 seconds from its clock, checks signatures with a constant-time
comparison, and atomically records each nonce in PostgreSQL beyond the
signature freshness window so the same signed request cannot be replayed. The
subject header alone is never trusted. Keep the signing secret in
the bridge and service secret stores; do not send it to the browser or include
it in run data. This contract has not yet been wired to a Life OS bridge or
deployed configuration.

As checked on 2026-10-10, DeepSeek's official peak cache-miss rate for
`deepseek-flash` is USD 0.30 per million input tokens and USD 1.20 per million
output tokens; off-peak rates are lower. Set the operator price variables to
the current official rates for the chosen model and service period. The app's
budget estimate is not an upstream provider hard cap; provider billing remains
authoritative.

Optional: `PORT` (default 8080), `AGENT_MAX_BUDGET_USD` (default 1),
`AGENT_MAX_OUTPUT_TOKENS` (default 4096), and `DB_POOL_SIZE` (default 8).

`npm run worker:once` claims at most one approved run, records its result in
PostgreSQL, prints only the stable run ID/provider run ID/outcome metadata, and
exits. It is suitable for a future task-triggered execution adapter; it does
not establish a scheduler, inbound wake-up API, or a 24/7 worker guarantee.
The HTTP service itself only creates, approves, and reads runs; it does not
launch a worker. A trigger adapter must be selected and explicitly authorized
before queued runs can execute automatically. Health reports
`taskTrigger: not_configured` so an API server alone cannot be presented as a
ready execution system.

Run `npm test` for offline contract/runner tests. Those tests use explicit fake
stores/providers; they do not establish PostgreSQL durability, real provider
execution, or cloud persistence. The service process uses PostgreSQL row locks
with `SKIP LOCKED`, lease epochs, and provider-call uncertainty states.

## One-off synthetic provider smoke test

From `agent-service/`, `npm run smoke:provider` is a no-call dry run by
default. It reports only whether the selected provider key and price variables
are present; it never prints their values. The executable integration mode is
opt-in:

```sh
npm run smoke:provider -- --execute --provider deepseek --max-output-tokens 128 --budget-usd 0.01
```

For a no-network end-to-end check of the service handler, file-backed fixture,
reopen, and event persistence, run
`npm run smoke:provider -- --offline-test`. It uses a synthetic fake provider
and does not read provider keys.

Execution requires the existing provider key and input/output price variables
in the invoking process environment. The script has no dotenv loader, does not
persist credentials, and generates temporary service/signing credentials in
memory. It sends one fixed synthetic prompt, makes one provider request with no
automatic retry, and caps output at 128 tokens and estimated budget at USD
0.01. It stores the result in a temporary file-backed PGlite 0.5.8
PostgreSQL-compatible WASM fixture, closes and reopens it to verify persistence,
then removes the fixture. Timeout and network failures are reported as
uncertain with the observed provider call and HTTP request counts. The success
result and both approval/success events are re-read after reopening the
database. This is a local reproducibility check, not evidence
of managed PostgreSQL, a hosted executor, or cloud persistence. Output contains
only model name, outcome, token usage, draft count, event types, and estimated
cost; it omits prompt content, credentials, run IDs, and provider request IDs.
Do not use this command for real user or business data.
