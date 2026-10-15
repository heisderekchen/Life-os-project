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

The overview may also display `externalMetrics` records returned by the
dashboard API. Each record must include a `workspaceId`; the client drops any
record whose workspace is not present in the authenticated grants response.
This is a display filter, not an authorization boundary: any future API that
returns external metrics must enforce grants server-side before sending values.
The current Life OS dashboard API does not return external business metrics, so
production shows the unavailable state until a real source is connected. When
the dashboard payload is marked `fixture: "test"`, overview copy and each
business metric source say that they are test data and do not represent live
integration. The fixture is never persisted or used as a fallback for
production data.

## Verified in the isolated preview

- TypeScript, ESLint, Vitest, and the optimized Next.js Webpack build passed.
- Vitest: 26 files, 180 tests. ESLint reports 0 errors and 5 existing
  unused-disable warnings.
- Headless browser: 360, 390, and 430 CSS px had no horizontal overflow;
  Overview, Reminders, and Tasks navigation worked; a local in-memory reminder
  could be created; the desktop Projects destination was visible, Apps & channels
  started expanded, selected/progress colors used the configured accent, and the
  Chinese date plus explicit test-source labels rendered correctly. An
  unauthorized metric was hidden; 1280 px desktop layout rendered; 0 page errors.
- This PR does not change schemas, migrations, production data, or account
  settings. Rust integration tests were not rerun because this PR only changes
  the frontend and documentation.

Mobile/desktop captures are in Library:

- Overview 390 px: `libfile_02cfc3cb3508819194214345069112e6`
- Reminders 390 px: `libfile_79f5c337d3408191a54c5b895d000704`
- Tasks 390 px: `libfile_919095a53c248191bf936a74610fef96`
- Tasks 1280 px: `libfile_802a4f52dda481918523023cf5d663a3`

## Release

The overview does not start task executors or schedulers. Production release
uses the repository's existing deployment workflow after the PR's checks pass.
