# MVP task cards and Worker routing

This slice adds durable task-card metadata and per-`type + role` Worker routing
to the private Life OS workspace. It is deliberately bounded: no model call is
made from this surface, no research/Obsidian integration is included, and no
platform-auth, session, export, import or reset behaviour is changed.

## Authorization contract

Enforced on every request, in this order:

1. `server.mjs` re-resolves the principal from the presented session cookie on
   every request (account session or the legacy entry-key session). Nothing is
   cached between requests.
2. The principal must be the stable legacy owner principal (`isLegacyOwner`),
   must be granted the Life OS workspace (checked fresh with the existing
   `workspacePageState` helper), and the resolved workspace must be exactly
   `ws_lifeos_legacy`; otherwise the whole surface answers `404` with no
   existence disclosure. The owner check keeps the private surface usable only
   by legacy owner A even if a `ws_lifeos_legacy` grant is ever mistakenly
   created for another account.
3. Every card read and write is filtered by `account_id + workspace_id +
   task_id`. Routing rows are filtered by `account_id + workspace_id +
   card_type + role`.
4. Routing writes additionally require the current platform-admin policy
   (`isPlatformAdmin` on the freshly resolved principal) and must name a
   provider/model pair that the server catalog reports as ready.

Consequences: anonymous callers, account B (even with a fixture grant for
`ws_lifeos_legacy`), and any principal granted only a different workspace receive
`404` everywhere. A card or routing row stored for another `account_id`, or
another `workspace_id`, is never readable, updatable or deletable, including
through guessed task ids. The legacy entry-key session is account A, so it keeps
card read/write access, but it is not a platform admin and therefore cannot write
routing.

Life OS task rows themselves carry no account column (the private workbench
module is owner-only); task existence is therefore re-validated against
`personal_workbench_lifeos_tasks` on every card request.

## API

All paths are served under the configured base path (`LIFEOS_BASE_PATH`, default
`/workbench`). Mutations require the trusted HTTPS proxy, the exact same
`Origin`, and (except bodyless `DELETE`) a JSON content type.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/task-cards/catalog` | task types, roles, statuses, Worker catalog and current routing |
| `GET` | `/api/task-cards/tasks/{taskId}` | one card plus the routing defaults for its type |
| `PUT` | `/api/task-cards/tasks/{taskId}` | create or replace the card for an existing task |
| `DELETE` | `/api/task-cards/tasks/{taskId}` | delete only this account/workspace/task card |
| `GET` | `/api/task-cards/routing` | routing rows for this account + workspace |
| `PUT` | `/api/task-cards/routing` | upsert `{ type, role, provider, model }` (platform admin only) |
| `DELETE` | `/api/task-cards/routing?type=&role=` | remove one routing row (platform admin only) |

Card payload: `type` (`bug` | `optimization` | `new_feature` | `environment` |
`test`, labelled Bug/优化/新需求/环境/测试), `goal`, `expectedArtifacts[]`,
`subtaskIds[]` (existing subtasks of this task), `dependencyIds[]` (existing
`lifeos_task_dependencies` rows of this task), exactly three role assignments
(`planner`/`developer`/`reviewer`, each optionally bound to a ready
provider/model), `verification[]`, `nextStep`, and `status` (`draft` | `ready` |
`done`). Validation failures answer `400` with a stable `code`
(`INVALID_TASK_CARD_TYPE`, `INVALID_GOAL`, `INVALID_STATUS`,
`INVALID_ROLE_ASSIGNMENTS`, `INVALID_WORKER_SELECTION`,
`INVALID_SUBTASK_REFERENCE`, `INVALID_DEPENDENCY_REFERENCE`,
`WORKER_MODEL_NOT_READY`, `INVALID_TASK_CARD_ROLE`), and nothing is written.

## Worker catalog

The catalog is server-side only. Supported backends are DeepSeek and OpenAI;
model ids come from operator configuration (`DEEPSEEK_MODEL`, default
`deepseek-flash`; `OPENAI_MODEL`, default `gpt-4.1-mini`), so the browser can
never invent a provider or a model id. Readiness is taken from the local AI
service health flags (`providers.deepseek` / `providers.openai`) that
`server.mjs` already reads; when the service is unreachable, every provider is
labelled not ready rather than assumed. Gemini is listed explicitly as
unavailable (`available: false`, `reason: not_in_server_catalog`) with no model
id, and any routing write that names `gemini` is rejected. Routing writes that
name a not-ready provider, or a model id that is not the configured catalog id,
are rejected with `WORKER_MODEL_NOT_READY`.

Readiness is cached for at most five seconds so an unreachable AI service cannot
add its probe timeout to every card request; a stored routing row always reports
its current `ready` flag from the latest probe.

The catalog payload contains no key, token, secret or environment value, and
this surface never calls a provider. Provider keys stay in the AI service.

## Storage and the export boundary

Additive migration `0094_lifeos_task_cards.sql` creates `lifeos_task_cards` and
`lifeos_task_worker_routing`. It is idempotent (`IF NOT EXISTS`) and safe to
re-run. Both tables are intentionally absent from `LIFEOS_EXPORT_TABLES`, so the
40-collection Life OS export, import and reset contract is unchanged: no card or
routing key appears in an export, an import payload containing such a key is
rejected as unknown, and a reset neither exports nor deletes card rows.

Known follow-up (not implemented here): when a Life OS task is deleted, its card
row is not removed automatically, because adding a cascading foreign key would
silently change the existing REPLACE-style import path. Such a row stays
unreachable through the API (task existence is re-checked on every request) and
is deleted with the delete endpoint. A guarded cleanup for deleted tasks should
be added with the next storage change.

## UI

`src/components/lifeos/tasks/task-card-panel.tsx` is mounted inside the current
Life OS task detail. It offers a Chinese read view (type, goal, expected
artifacts, existing subtasks/dependencies, three role assignments, verification
evidence, next step, routing defaults) plus a responsive edit form
(`sm:` breakpoints, single column on phones). It calls only
`/api/task-cards/*` on the same origin; it never calls `/api/agent` or a
provider.

## Tests

* `node deploy/standalone/scripts/test-task-cards.mjs` — in-memory (no sockets):
  migration rerun, anonymous/B/other-workspace denial, account-A CRUD,
  validation matrix, catalog readiness without secrets, Gemini labelling,
  platform-admin routing policy, unchanged export/reset/import boundary and the
  view contract.
* `node deploy/standalone/scripts/test-task-cards-http.mjs` — loopback HTTP
  boundary: the same authorization and CRUD checks through real cookies, plus
  the same-origin/content-type guards on mutations.

Both use SQLite fixtures and a fake AI service only: no real credentials and no
provider network call.

## Research state machine and Obsidian sync interface

Implemented in a later, separately reviewed slice under
`/api/research/*`. It reuses the same authorization order above (fresh
principal, `isLegacyOwner`, exact `ws_lifeos_legacy` grant, account+workspace+task
scoping) through `resolveLifeOsScope`, stays outside platform-auth/session files
and the 40-collection export/import/reset contract, and adds its own additive,
idempotent migration `0095_lifeos_research_state.sql` plus in-process and loopback
tests. It keeps provenance (source, date, confidence) in deduped evidence rows
separate from the task card.

The current executor and vault boundaries are stated honestly in
`docs/research-obsidian-sync.md`: there is no Neo integration or research
scheduler, so an explicit start only persists `waiting_executor`
("等待 Neo/研究执行器连接") and never reports `running`; and there is no
filesystem/vault access, so Obsidian reports disabled/unconfigured and only
stages `pending_sync` outbox rows.
