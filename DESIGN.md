---
name: myOS project workspace
description: A linked ownership map and dense task workbench inside the existing myOS shell.
colors:
  workspace-primary: "#0f766e"
  workspace-primary-foreground: "#ffffff"
  workspace-primary-dark: "#5eead4"
  workspace-primary-dark-foreground: "#042f2e"
typography:
  title:
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  pane-title:
    fontSize: "16px"
    fontWeight: 600
  body:
    fontSize: "13px"
  label:
    fontSize: "12px"
  status:
    fontSize: "11px"
rounded:
  compact: "4px"
  control: "6px"
  switch: "7px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  pane: "20px"
  page: "24px"
components:
  view-active:
    backgroundColor: "{colors.workspace-primary}"
    textColor: "{colors.workspace-primary-foreground}"
    rounded: "{rounded.compact}"
    padding: "7px 12px"
  view-active-dark:
    backgroundColor: "{colors.workspace-primary-dark}"
    textColor: "{colors.workspace-primary-dark-foreground}"
    rounded: "{rounded.compact}"
  graph-node:
    rounded: "{rounded.control}"
    padding: "12px 11px"
    width: "190px"
  status-chip:
    rounded: "{rounded.compact}"
    padding: "3px 6px"
  search:
    rounded: "{rounded.control}"
    height: "39px"
---

# Design System: myOS project workspace

## Overview

**Creative North Star: "From structure to action"**

This is an Operate-mode extension of the existing myOS interface. Preserve its sidebar, app header, typography, theme preferences, dialogs, and execution controls. The workspace adds a restrained teal selection language to neutral surfaces, thin dividers, and compact operational rows.

This document describes the project workspace only. Its split composition and graph geometry do not replace layout rules for other app modules. The approved direction is recorded in `.impeccable/surfaces/project-workspace.md`.

**Key Characteristics:**
- One filtered dataset and one selection across graph, table, and inspector.
- Dense rows with recognizable folder, topic, and document symbols.
- Existing theme and system font behavior, with a local workspace accent.

## Colors

### Primary

Deep teal is the workspace selection and action color in light mode; mint teal is its dark-mode counterpart. Use the corresponding foreground token for filled controls. These overrides remain inside the workspace and do not recolor the app shell.

### Neutral

Inherit `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, and `--ring` from the active app theme. Preserve their source CSS color formats and runtime preference overrides. The graph edge mixes foreground at 30% with background. Selected nodes mix primary at 9% with card; selected rows mix primary at 10% with background. In-progress chips mix primary at 13% with background. Errors and overdue labels inherit the app destructive color.

**The Local Accent Rule.** Workspace selection tokens must stay scoped to this surface; neutral and shell tokens remain app-owned.

## Typography

Retain the incumbent app/system sans stack and Chinese fallback behavior; add no font assets. The frontmatter records observed workspace sizes, without overriding the inherited family. The title contracts to 21px on phones. Graph labels use 15px; table content uses body size; dates, captions, and field labels use label size. Counts and dates use tabular numerals. Desktop row titles truncate with a full-title tooltip; phone titles may occupy two lines. Inspector headings and ownership paths wrap.

## Layout

The desktop linked view defaults to 43% graph and 57% table plus inspector, with a draggable separator. The list/detail separator defaults to a 60/40 split. Desktop, stacked and list/detail ratios persist separately in this browser; pointer or keyboard resizing is immediate and a double-click resets the corresponding ratio. Shared search, project/type/sort controls, and status filters sit above both panes. List and graph modes each occupy the full content width. The incumbent sidebar and app header retain their own behavior.

Use page spacing for desktop gutters, pane spacing inside panels, and compact spacing for controls. Table headers are sticky (42px); task rows are 48px, with 43px group/topic rows. The full table minimum width is 670px. Between 1001px and 1500px, linked mode uses a 530px table and hides the due-date column. At 1000px or below, linked panes stack vertically; forms use two columns. At 600px or below, use 12px gutters, horizontally scroll the 700px table, and expose utility actions through the native More disclosure. First use below 900px defaults to list; a stored view preference remains authoritative. The incumbent app touch rules maintain a 44px minimum control height on phones; the More trigger also keeps a 44px width.

The inspector and table scroll independently inside resizable tracks. Ratios range from 25 to 75; CSS track minima keep desktop graph/list widths at 240/320px and table/detail heights at 140/120px. At narrow widths the linked tracks stack with 242/330px minima and scroll inside the workspace when necessary. Separators expose orientation, value and named pane relationships; arrow keys adjust, Shift increases the step, Home/End reach the ratio limits, and double-click restores defaults. Avoid widening the document to fit the table.

## Elevation & Depth

The workspace is flat at rest: thin dividers and muted surface changes establish hierarchy. Graph nodes use a restrained low shadow; selected nodes strengthen it slightly. Graph controls receive a small utility shadow, and the More menu uses a raised overlay shadow. Existing full-detail dialogs keep the incumbent app treatment. Exact shadow values live in the sidecar.

## Shapes

Controls and graph nodes use gently curved control corners; chips and inner view buttons use compact corners. The view-switch wrapper uses the switch radius. Preserve one-pixel borders and small line icons. Do not replace operational rows with decorative cards.

## Components

- **View switch:** Linked, List, and Graph share one preference. The pressed choice uses the filled local accent; keyboard focus remains visible.
- **Search and filters:** One search field and shared project/type/status filters update both representations immediately. Status counts belong in actionable filters. Use the inherited focus ring with a two-pixel offset; search focuses its enclosing field.
- **Ownership graph:** Project → topic → task → subtask columns use 190px nodes on a 214px stride. Task positions advance by 86px. Render every task in an expanded branch with its recorded parent links; no seven-task truncation or overflow placeholder. Ordinary selection preserves the current viewport, including manual zoom and pan, and scopes the list and inspector. Selecting a hidden task also opens its owning branch and all known ancestor owners. Fit the complete expanded network after topology or container-size changes, once node dimensions are measured. Expansion has a separate control.
- **Table and inspector:** A row selection highlights its graph node and opens its inspector. Hierarchical rows retain all peer projects and their metadata under the explicit filters, with normal expand/collapse navigation. Flat rows retain the selected project/topic scope. Selection preserves the current graph viewport. Status remains text-readable: completed is muted, cancelled is muted and struck through, and overdue uses destructive text. Editing ownership persists through the server; a topic belongs to one project. Unassigned project and Unclassified remain explicit choices. Missing subtask ownership may inherit from a recorded parent for display; edits use the original API record.
- **Column sorting:** All five table headers share the toolbar sort state and expose direction through `aria-sort`. Empty dates/types stay last in both directions.
- **Node arrangement:** Nodes can be dragged directly without moving the canvas. Positions persist in this browser across view changes and reloads; Reset node layout restores automatic positions. Background drag remains pan, and dragging never changes ownership or recorded parent links.
- **Context actions:** Graph nodes and hierarchy rows share the incumbent Radix menu pattern. Unclassified under a real project can be named as a real topic; this explicit action atomically assigns the project’s unclassified tasks regardless of current filters and preserves parent IDs. Real entities also support title double-click and graph F2 rename. Visible, named Actions triggers expose the same commands to keyboard and touch input; phone targets remain at least 44px. Menu entry is 120ms, exit is immediate, and reduced motion removes animation.
- **Actions and details:** Reuse existing primary, outline, ghost, destructive, input, and dialog components. Full details opens the existing execution workspace. The native phone More menu contains project/topic creation, project management, and recurring/execution access.
- **Feedback and motion:** Loading, retry, empty results, saving, and field errors remain explicit. Semantic selection/filter updates are immediate. Optional graph viewport movement takes 180ms and yields to a newer selection; reduced motion uses zero-duration positioning and suppresses workspace transitions/animation. Add no entrance or decorative motion.

## Do's and Don'ts

### Do:
- **Do** preserve one dataset, one selection, and the project → topic → task → subtask relationship.
- **Do** inherit the existing app shell, typography, neutral tokens, and full-detail controls.
- **Do** keep explicit Unassigned project and Unclassified states and persist user ownership edits on the server.
- **Do** retain horizontal table scrolling, visible keyboard focus, and the phone touch-target floor.

### Don't:
- **Don't** persist inferred ownership for existing unclassified records; display inheritance may follow recorded parent links.
- **Don't** add decorative card grids, entrance animation, or new font assets to this workspace.
- **Don't** treat fixture screenshots as evidence of real-account acceptance or deployment.
- **Don't** apply this workspace composition or local accent globally.
