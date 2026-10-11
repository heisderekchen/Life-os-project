# Research state machine and Obsidian sync interface

This slice adds a reviewable, first research state machine for the private Life
OS workspace plus a disabled-by-default Obsidian sync interface. It is
deliberately bounded and honest about what does not exist yet:

* There is **no Neo integration and no research scheduler** in this repository.
  The Agent Service only exposes single, manually approved DeepSeek/OpenAI runs.
  An explicit start therefore persists `waiting_executor`
  ("等待 Neo/研究执行器连接"); it never reports `running`, never calls a model and
  never fabricates a worker heartbeat.
* There is **no filesystem or vault access**. The Obsidian endpoint reports
  disabled/unconfigured and only stages user-reviewed incremental artifacts into
  a separate scoped outbox as `pending_sync`. Vault root/subfolder permission is
  still pending user authorization, so no filesystem configuration is wired and
  nothing is ever written.
* History is **append-only**. There is no plan-delete endpoint and no
  replan-erasure: rounds and evidence are never deleted or overwritten, and a
  task that already produced any round or evidence can no longer be re-planned.

## Authorization contract

Enforced on every request, reusing the task-card slice:

1. `server.mjs` re-resolves the principal from the presented session cookie on
   every request. Nothing is cached between requests.
2. Authority is resolved through `resolveLifeOsScope` (from `task-cards.mjs`):
   the stable legacy owner principal (`isLegacyOwner`), a fresh grant for the
   Life OS workspace (`workspacePageState`), and the exact stable workspace id
   `ws_lifeos_legacy`. Anything else answers `404` with no existence disclosure.
   The owner check keeps the private surface usable only by legacy owner A even
   if a `ws_lifeos_legacy` grant is ever mistakenly created for another account.
3. Every session, round, evidence and outbox read/write is filtered by
   `account_id + workspace_id + task_id`, and the task id is re-validated
   against `personal_workbench_lifeos_tasks` on every request. Caller-supplied
   account/workspace identifiers are never trusted.

Consequences: anonymous callers, account B (even with a fixture grant for
`ws_lifeos_legacy`) and any principal granted only a different workspace receive
`404` everywhere. Sessions, rounds, evidence and outbox rows stored for another
`account_id`, another `workspace_id` or another `task_id` are never readable,
updatable or deletable, including through guessed task ids. The legacy entry-key
session is account A and keeps access.

## API

All paths are served under the configured base path (`LIFEOS_BASE_PATH`, default
`/workbench`). Mutations require the trusted HTTPS proxy, the exact same
`Origin`, and a JSON content type. There is no `DELETE` route.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/research/catalog` | caps, modes, statuses, confidence levels, the source/action option catalogs, executor + Obsidian status |
| `GET` | `/api/research/tasks/{taskId}` | the plan/session plus its rounds, deduped evidence and outbox |
| `PUT` | `/api/research/tasks/{taskId}` | create/replace the **draft** plan (never runs); rejected with `SESSION_HAS_HISTORY` once a round or evidence exists |
| `POST` | `/api/research/tasks/{taskId}/start` | explicit start: **only** `draft` → `waiting_executor` (`409` from any other state) |
| `POST` | `/api/research/tasks/{taskId}/pause` \| `/resume` \| `/cancel` | deterministic lifecycle |
| `POST` | `/api/research/tasks/{taskId}/rounds` | executor-report intake (closed while no executor is connected) |
| `POST` | `/api/research/tasks/{taskId}/obsidian` | stage a user-reviewed artifact into the outbox as `pending_sync` |
| `GET` | `/api/research/tasks/{taskId}/obsidian/status` | Obsidian availability plus **this task's** pending outbox (task-scoped; there is no workspace-wide outbox listing) |

Every route, including `GET` and all lifecycle routes, re-validates the task id
against `personal_workbench_lifeos_tasks`, so an orphan research row whose task
no longer exists is never readable or transitionable.

## Server-owned execution caps

Caps are immutable and live only in the server (`RESEARCH_EXECUTION_CAPS`).
Every plan write is validated against them and anything above a cap is rejected
with `EXCEEDS_SERVER_CAP` (or the field's `INVALID_*` code for malformed values);
nothing is written. No request field — and no model-produced field later — can
widen the budget, the frequency, the source/action allowlists or the
concurrent/subtask limits.

| Cap | Value |
| --- | --- |
| `maxRounds` | 20 |
| `maxConcurrency` | 1 |
| `maxSubtasks` | 1 |
| `maxSources` / `maxActions` | 20 / 20 |
| `maxCostLimitUsd` | 1 |
| `minFrequencyMinutes` / `maxFrequencyMinutes` | 60 / 1440 |
| `maxBackoffMinutes` | 1440 |
| `maxEvidencePerRound` / `maxCitations` | 50 / 20 |

The budget is a **real finite cap**: it is matched to the existing Agent Service
default of `$1` total, a missing value falls back to that safe server-owned
default, and a zero or negative budget is rejected with `INVALID_COST_LIMIT`.
There is no "0 means unlimited". The first slice allows exactly one concurrent
subtask, and a plan can never re-check more often than once an hour
(`minFrequencyMinutes` 60). Client-reported spend is never accepted. With no real
executor the stored `cost_spent_usd` is always zero; the server-owned stored value
is the only source, both for the session payload and for the terminal budget
check.

## Server-owned source/action option catalogs

The source and action allowlists are not free text. `GET /api/research/catalog`
returns two immutable option catalogs and a plan may only use those ids; anything
else is rejected with `UNKNOWN_OPTION` and nothing is written:

* sources — `user_provided_reference`, `selected_obsidian_reference`;
* actions — `deduplicate_evidence`, `draft_next_question`,
  `stage_obsidian_artifact`.

Every option is abstract and inert. There is no web fetch, no browser and no
model action behind any option in this slice; the request (and any future model
output) cannot add, rename or widen a catalog entry.

## Persisted state

A session persists: mode (`once` | `continuous`), goal/target, source and action
allowlists, unresolved questions, next question, checkpoint, cost limit and
server-owned spend, frequency and next check time, subtask cap and concurrency,
the configured (cap-bounded) maximum rounds, round count, no-new-evidence streak,
status and terminal reason. Rounds persist per round; evidence is stored deduped
with source, reference, summary, observed date and confidence.

## Lifecycle and the deterministic engine

Statuses are `draft`, `waiting_executor`, `paused`, `cancelled`, `stopped`. Plan
create/replace is always `draft` and never runs. `start` is **only** the
`draft → waiting_executor` transition; every other source state returns `409`, so
a paused session can never be turned back on except through the explicit
`resume` control. `pause`/`resume` toggle between `paused` and
`waiting_executor`; `cancel` is terminal and idempotent; a terminal session
cannot start or take rounds. Re-planning is only allowed on an idle plan that has
no history yet (absent, or `draft` with zero rounds/evidence); an active session
must be paused and cancelled first, and once any round or evidence exists —
including stopped/cancelled history — re-planning is rejected with
`SESSION_HAS_HISTORY`. Rounds/evidence are never erased and the outbox is
separate and preserved.

The round engine (`applyResearchRound`) is a pure, deterministic function of the
session, the reported candidate evidence and an explicit `now`:

* **Dedupe** — evidence is keyed by a stable hash of source + source reference +
  content, so identical source+content references collapse to one row.
* **Backoff** — a round with no new evidence schedules
  `min(frequency * 2^streak, maxBackoffMinutes)`; fresh evidence resets the
  streak and returns to the base frequency. No background execution is implied.
* **Terminal stop** — evaluated in a fixed order: `goal_achieved`,
  `budget_exhausted`, `max_rounds`, then `once_mode_completed` (once mode stops
  after one round). A completed round otherwise leaves the session in
  `waiting_executor`; it never becomes `running`.

The `POST /rounds` intake applies this engine but is **closed** whenever no
executor is connected (`409 EXECUTOR_NOT_CONNECTED`), which is always the case
in the current server. It exists as the future adapter contract and is exercised
in tests with an injected fake executor only.

## Obsidian interface (disabled / pending sync)

`GET /api/research/tasks/{taskId}/obsidian/status` and the catalog report
Obsidian as `enabled: false`, `configured: false`,
`reason: filesystem_permission_pending`. The status route is task-scoped and
lists only that task's outbox; the old workspace-wide `/obsidian/status` route is
removed. `POST /api/research/tasks/{taskId}/obsidian` validates an explicitly
selected folder, bounds the generated block, and stages metadata/body + selected
relative path + citations into `lifeos_obsidian_sync_outbox` as `pending_sync`.
Staging is idempotent for an identical path + block, and it never writes to any
file.

An adapter contract is defined and tested with an in-memory fake
(`createInMemoryObsidianAdapter`) only. A future real adapter must:

* validate an explicitly selected folder and reject traversal / absolute paths /
  non-`.md` targets / paths outside the folder;
* append only a bounded generated block (never overwrite);
* compare the expected base hash and, on mismatch, return a conflict
  (`base_hash_mismatch`) without overwriting the user's edits;
* start a new file from an empty base when it does not exist yet.

No whole-vault scan and no whole-vault upload happens anywhere. The adapter is
not wired into `server.mjs` in this pass.

## Storage and the export boundary

Additive migration `0095_lifeos_research_state.sql` creates
`lifeos_research_sessions`, `lifeos_research_rounds`, `lifeos_research_evidence`
and `lifeos_obsidian_sync_outbox`. It is idempotent (`IF NOT EXISTS`) and safe to
re-run. None of these tables is part of `LIFEOS_EXPORT_TABLES`, so the
40-collection Life OS export/import/reset contract is unchanged: no research or
outbox key appears in an export, an import payload containing such a key is
rejected as unknown, and a reset neither exports nor deletes these rows.

Rollback notes: the migration is standalone and referenced only by
`src/research.mjs`. To roll it back, stop the service, drop the four tables, and
delete the `0095_lifeos_research_state.sql` row from `lifeos_schema_migrations`.
No platform-auth/session table, no store schema and no other Life OS contract is
touched, so the rollback cannot cascade.

## UI

`src/components/lifeos/tasks/research-panel.tsx` is mounted inside the current
Life OS task detail next to the task-card panel. It offers a Chinese read view
(mode, goal/target, allowlists, unresolved questions, next question, checkpoint,
cost/frequency/rounds, subtask/concurrency caps, rounds history, deduped evidence
with source/date/confidence and the pending Obsidian outbox) plus a responsive
edit form (`sm:` breakpoints, single column on phones) and an explicit Chinese
start button ("开始研究"). Source and action choices are rendered as
checkbox options taken from the server catalog, never as free text. There is no
delete control: history is never erased. The panel reads only task-scoped
`/api/research/*` routes on the same origin; it never calls `/api/agent` or a
provider. The panel states the pending executor and vault limitations in
Chinese.

## Tests

* `node deploy/standalone/scripts/test-research.mjs` — in-memory (no sockets):
  migration rerun, anonymous/B/forged denial, other account/workspace IDOR, cap
  enforcement (including a zero/negative budget and the 60-minute lower bound),
  the server-owned option catalogs, orphan-task validation, draft-only start,
  the no-history-erasure replan rejection, task-scoped outbox, draft/start/pause/
  resume/cancel, the dedupe + backoff + terminal engine, the closed executor
  intake, pending-sync staging, the adapter conflict contract, the unchanged
  export/reset boundary and the view/server contract.
* `node deploy/standalone/scripts/test-research-http.mjs` — loopback HTTP
  boundary: the same authorization and lifecycle checks through real cookies,
  plus the same-origin/content-type guards on mutations.

Both use anonymous SQLite fixtures and a fake AI-service health probe only: no
real credentials, no provider network call and no vault access.
