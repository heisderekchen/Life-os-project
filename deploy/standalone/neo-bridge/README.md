# NEO HappyspaBench sender (not activated)

This is a reviewable sidecar for the existing read-only collector. It is not a
LaunchAgent, does not import the controller, and is not invoked by deployment.
It accepts only the collector's verified `parse_complete_snapshot` shape:
`observed_at`, `today_spend`, `today_label`, `data_state`, `list_loaded`,
`expected_plan_count`, `store_identity_verified`, and `plans`.

The sidecar stages deterministic-event-ID records in a local JSON outbox,
retries with capped exponential backoff, and expires records older than 10
minutes (the receiver freshness window) without sending them. It stages only
`official_snapshot` and `neo_heartbeat`: `plan_confirmation` remains absent
until a separate validated plan source exists, rather than being inferred.
The endpoint is immutable. Its only secret input is the
runtime environment variable `HAPPYSPA_BENCH_OUTBOX_TOKEN`; configuration,
output, and logs never contain the value.

The controller maintainer must separately review and wire this sidecar after a
successful `collect()` result. No code here changes promotion status, browser
profiles, or LaunchAgent configuration.
