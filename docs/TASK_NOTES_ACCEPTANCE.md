# Task overview notes

Recorded 2026-10-20. Scope: an ordinary extension of the selected task inspector in the existing standalone myOS workbench. The user requested notes containing text and pictures. Existing graph, hierarchy, peer navigation, pane resizing and full task details remain the incumbent surface contract.

## Delivered behavior

- A task selection exposes its title, a labelled note composer, upload/paste input and newest-first history. “写备注” focuses the composer. Notes are independent records rather than replacements for the task description.
- A note accepts text, images, or both; empty notes are rejected. The server caps text at 20,000 Unicode characters. Each note allows four PNG/JPEG/WebP source images, each at most 8 MiB. The browser reduces the longest edge to at most 1600 px, lowering dimensions/quality as needed to store each image within 160 KiB.
- History loads 20 records per page. Images open in the existing dialog pattern. Task and note scoping, authentication, content sniffing, `no-store` and `nosniff` protect image responses.
- Drafts are kept separately per task during the page session. Failed saves retain the draft. Editing and deleting use revision checks. An edit conflict loads the latest revision while retaining the draft for manual merge. A delete conflict refreshes history, preserves the composer and requires a new confirmation. Deletion uses an inline confirmation.
- Migration 0102 adds storage. Note writes, task touch/audit and relevant changes are transactional. Task deletion cascades to notes; backup export/import includes notes, while importing an older backup without `taskNotes` preserves current notes.

## Surface and system

The notes section inherits existing neutral surfaces, teal actions, system type, dividers, buttons and dialog. It adds no design tokens or decorative motion. Notes use a 15 px local heading, 13 px body and 12 px metadata; this is observed component usage, not a new global type scale. Text preserves newlines and wraps long content. The composer has visible focus and explicit loading, saving, retry, empty and error feedback. At widths up to 600 px, upload/edit/delete targets retain the 44 px floor; the selected task list/detail area has a 760 px minimum to keep the composer reachable through nested scrolling. Idle inspector behavior is unchanged.

## Evidence and acceptance boundaries

DeepSeek implementation evidence is retained in `output/deepseek/task-notes-backend.md` and `output/deepseek/task-notes-frontend.md`. Successful calls used `deepseek-flash`; the first backend call timed out at 120 seconds and its retry used 300 seconds. Only requirements and the frontend contract were sent; no business screenshot, production/account data or environment secrets were included.

Local verification reported by the integrating agent:

- 215 core tests passed before the final delete-conflict recovery correction; the final nine task-notes component tests passed after that correction.
- `/tmp/lifeos-notes-server-tests.log` covers reconnect, revision races, rollback, pagination, backup and cascade behavior against the isolated Node/SQLite request handler.
- `/tmp/lifeos-notes-build.log` records the latest production build/type checks; lint passed.
- A prior browser run exercised actual upload, clipboard images, private-image 404, real edit conflict and manual merge, failed-save 503/retry, inline deletion and reload persistence of two notes. The final browser rerun in `/tmp/lifeos-notes-browser.log` passed after the correction, including `realDeleteConflictRecovery: true`, upload, clipboard, reload, edit conflict, failed-save recovery, confirmed deletion and unauthenticated image 404. The stored screenshot compressed to 11,966 bytes.
- Review captures at `.impeccable/review/task-notes/user-1854.png`, `desktop.png` and `mobile.png` were updated and opened successfully by the integrating agent.
- The existing detector result `/tmp/lifeos-notes-detect.json` reports zero primary findings and seven advisories. Pre-existing font-ramp drift and the local 15 px heading were not converted into new global tokens or repaired as part of this extension.

This evidence concerns an isolated real gateway and a Next production browser build. CI, publication and deployment are not confirmed by this checkpoint. No production records were written. Physical touch, assistive-technology and real production-account acceptance remain unverified. Final CI and release status are tracked by the pull request checks and production workflow.
