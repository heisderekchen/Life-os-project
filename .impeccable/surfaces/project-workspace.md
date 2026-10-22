# Unified project workspace
Mode: Operate. Scope: project/topic/task/subtask organization; preserve existing execution details.
## Direction contract
THESIS: One selection and one filtered dataset connect a spatial ownership tree with dense operational rows.
OWN-WORLD: Preserve the app theme; neutral surfaces, restrained teal/primary selection, system Chinese typography, thin dividers, compact rows, recognizable folder/document icons.
STORY: Find a project, expand a topic, select a task, read status/type/update time, edit its ownership, and resume the full task workspace.
FIRST VIEWPORT: Title and view switch above shared filters; graph takes about 43% and hierarchical table/detail about 57%. Real counts and real tasks only. A narrow viewport defaults to list and keeps graph available.
FORM: User-approved linked two-pane workspace. Seed: user-approved-preview-20261019. Named signature: selecting a row highlights its graph node and inspector; hierarchy retains peer projects while flat mode uses the selected scope.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
## Motion
Selection and filtering are immediate. Optional graph viewport movement takes 180ms, interrupted by a newer selection; reduced motion uses an immediate jump. No entrance or decorative animation.
## Acceptance
Server persistence, reloading, cross-project topic rejection, unclassified/inbox visibility, shared filtering, keyboard access, empty/error/loading states, desktop and phone overflow, and the existing task execution dialog.

## Feedback refinement 2026-10-19
Honor recorded parentTaskId in graph, hierarchy, filter context and flat-row breadcrumbs. Inherit missing ownership only for display; explicit ownership and API records stay authoritative. Rename Inbox to Unassigned project. Reuse app Radix menus for graph/row context actions, keyboard and touch access; use existing dialogs for rename and ownership edits. All five table headers share the existing sort state, expose aria-sort, and keep empty dates last. Menu entry is at most 120ms, reduced motion removes it; commands do not wait on animation.

## Screenshot rejection correction 2026-10-19
The circled Unclassified topic must support Rename to create a real topic and assign the whole project group atomically, preserving parentTaskId. Keep duplicate validation and rollback. Node drag changes local browser layout, background drag pans, and Reset restores automatic layout. Clicking a parent reveals children; cross-ownership parent links remain drawn when endpoints are visible.

## Complete-network selection correction 2026-10-19
Ordinary selection scopes the flat list and inspector; hierarchy retains all projects allowed by explicit filters; selecting a hidden task also reveals its branch and all known ancestor owners. The graph keeps every expanded node and edge, including all task siblings beyond seven, and fits topology/container-size changes as a whole network without a zoom floor that crops distant parents. Ordinary selection preserves the exact user viewport, including manual zoom and pan. A separate expand/collapse control remains available; browser-local drag positions remain unchanged by selection. The complete graph may require a smaller overview scale; zoom/pan remain available.

## Peer projects and resizable panes 2026-10-19
Keep all project rows allowed by explicit filters in hierarchy after selecting a project, topic or task; peers remain navigable and expandable. Flat rows keep selected-scope behavior. Add direct-manipulation separators for graph/list and table/detail with keyboard, pointer capture/cancellation, bounded track sizes and browser persistence. Desktop and stacked graph ratios are separate; graph-only omits separators, list-only keeps the detail separator when details are shown; on phones, idle detail and its separator consume no space. Resize is immediate without animation. Preserve the existing neutral/teal system and complete graph behavior.

## Selected task notes extension 2026-10-20
The selected task inspector adds a labelled text/image composer, task-title context and newest-first note history, using incumbent surfaces, controls and dialogs. “写备注” focuses the composer. Upload and clipboard images show removable previews; saved thumbnails open a dialog. Keep per-task page-session drafts, explicit failure/retry feedback, revision-conflict merge recovery and inline delete confirmation. A delete conflict refreshes history without clearing the composer and requires confirmation again. At widths up to 600px, the selected task list/detail area uses a 760px minimum with nested scrolling so the composer remains reachable; idle detail behavior stays unchanged. Add no tokens or decorative motion. Evidence, limits and unverified release/acceptance layers are recorded in `docs/TASK_NOTES_ACCEPTANCE.md`.

## Focus mode and resize following (2026-10-22)
Task rows and current task details lead; the graph supports them. Focus uses a non-overlapping compact app bar, less header chrome, existing More disclosure for utility actions, and independent persisted 32/68 graph/task and 70/30 list/detail ratios. Idle details collapse. Project/topic/task selection stays unchanged while a ResizeObserver keeps its row inside the task scroll viewport, below the sticky table header. Manual scrolling remains free. Validate normal and focus layouts at desktop, intermediate and phone widths; fixtures are synthetic and do not establish real-account acceptance.
