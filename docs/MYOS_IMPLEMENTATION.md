# myOS implementation scope

myOS is the user-facing workspace brand and overview. Existing Life OS storage,
API names, account authorization, Tasks, Projects, and chart components remain
in place for compatibility.

## Reminder storage and rollback

Reminders use the existing CalendarEvent record with `eventType = "reminder"`
and `completed` state. Calendar events default to `event`; reminders have no
`taskId` and do not enter project task lists. This additive migration preserves
all pre-existing event data.

To roll back after backing up reminder records, remove the two added columns:

```sql
ALTER TABLE CalendarEvent DROP COLUMN completed;
ALTER TABLE CalendarEvent DROP COLUMN eventType;
```

For the standalone SQLite schema, use `event_type` and the same `completed`
column names. Rollback converts reminders to generic calendar events before
dropping their classification; it does not delete their title or date.

## Live-source boundary

The workspace switcher only lists entries returned by the authenticated
`/api/platform/workspaces` endpoint and navigates through the server's
grant-checked `/workspace/:slug` route. If no workspace is granted or configured,
myOS says so instead of inventing business systems or metrics. Task progress,
plans, research rounds, and outputs are shown only when the corresponding
existing task, task-card, or research API returns them. No execution loop is
started by the myOS overview.

## Verified in the isolated preview

- TypeScript, ESLint, Vitest, and the optimized Next.js Webpack build passed.
- Vitest: 25 files, 175 tests. ESLint reports 0 errors and 5 existing
  unused-disable warnings.
- Headless browser: 360, 390, and 430 CSS px had no horizontal overflow;
  Overview, Reminders, and Tasks navigation worked; a local in-memory reminder
  could be created and completed; 1280 px desktop layout rendered; 0 page errors.
- Both migration SQL files and the standalone JavaScript module were checked
  locally. Rust integration tests remain unrun because this environment has no
  `cargo` executable.

Mobile/desktop captures are in Library:

- Overview 390 px: `libfile_02cfc3cb3508819194214345069112e6`
- Reminders 390 px: `libfile_79f5c337d3408191a54c5b895d000704`
- Tasks 390 px: `libfile_919095a53c248191bf936a74610fef96`
- Tasks 1280 px: `libfile_802a4f52dda481918523023cf5d663a3`

## Release gate

The local `origin/main` ref is `16ff2cd`, while GitHub reports current `main`
at `d159ae5` (which includes commits after local `16ff2cd`). Git transport cannot
fetch in this environment. Rebase onto current `main` and run the Rust test suite
before creating a PR or deploying. No production data or settings were changed.
