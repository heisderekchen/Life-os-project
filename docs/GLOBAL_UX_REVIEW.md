# Life OS global UX review (October 12, 2026)

## Actual navigation map

This frontend uses one Next page (`/` in the standalone development preview and `/workbench` in the private deployment shell). It does not expose one URL per Life OS module. `AppShell` switches a mounted client page through the persisted `activeModule` value; `moduleComponents` currently registers these screens:

| Group | Module | Screen component | Navigation availability |
| --- | --- | --- | --- |
| Overview | Dashboard | `DashboardPage` | All users |
| Productivity | Tasks | `TasksPage` | All users |
| Productivity | Projects | `ProjectsPage` | All users |
| Productivity | Notes | `NotesPage` | Enabled module |
| Productivity | Calendar | `CalendarPage` | Enabled module |
| Productivity | Time | `TimePage` | Enabled module |
| Wellness | Habits | `HabitsPage` | Enabled module |
| Wellness | Journal | `JournalPage` | Enabled module |
| Growth | Goals | `GoalsPage` | Enabled module |
| Growth | Learning | `LearningPage` | Enabled module |
| Growth | Finance | `FinancePage` | Enabled module |
| Preferences | Settings | `SettingsPage` | Sidebar bottom action; also profile menu |
| Administration | Accounts | `PlatformAccountsPage` | Only rendered for a platform admin |

Before these modules, `AppShell` can render the welcome or setup experience. Those are setup gates rather than module routes.

## Original iteration (superseded by the current mobile navigation)

1. **Use the registered top-level categories on phone.** The user rejected the earlier Dashboard/Tasks/Projects/More shortcut bar and the Common/Work/Life directory. The current design uses Overview, Productivity, Wellness, and Growth as bottom-level categories, with Settings as a separate personal/settings entry.
2. **Keep desktop and mobile category names aligned.** The desktop rail uses the same four top-level categories; Settings stays in the rail's bottom action area and Accounts remains admin-only.
3. **Give content pages a common heading and action rhythm.** Use one responsive heading component for title, supporting text, and the primary action. Apply it to Projects and Settings first; retain their module-specific controls and screens.
4. **Review every module's content and state patterns.** After shell adoption, inspect title/action placement, mobile overflow, loading/empty/error states, form feedback, keyboard return, and bilingual labels across Dashboard, Tasks, Projects, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, Settings, and the role-gated Accounts screen. Repair by screen in follow-up commits without changing APIs, authorization, persisted data, or business behavior.

## Earlier change batch (revised below)

- Added a mobile primary nav for Dashboard, Tasks, Projects, and More, later superseded by the category navigation below.
- Removed the duplicate hamburger from the mobile header after adding More, leaving the active module breadcrumb and existing search, language, quick-add, notification, and profile controls.
- Reorganized desktop navigation as Plan (Dashboard, Projects, Calendar, Goals), Do (Tasks, Notes, Time), and Life (Habits, Journal, Learning, Finance). Plan and Do remain visible; Life uses a native `details` disclosure. The collapsed desktop rail still exposes all module icons.
- Added `ModulePageHeader` and applied it to Projects and Settings. Project filters, search, and primary create action meet the 44px touch target design target; settings tabs become a horizontally scrollable row on narrow screens and remain a vertical rail on larger screens.
- The task edit workspace now uses a separate bottom action area, so the content scroller ends above Return/Save controls and inputs do not scroll underneath them.
- Replaced the task status-chip row with a prominent, low-box-count work queue: In progress, Needs attention (overdue), Next up, and All tasks. Fine-grained status filters remain available in a disclosure.
- The global store emits a cancellable pre-navigation event before changing modules. An edited task can prevent navigation when the user declines the unsaved-changes prompt, regardless of which app navigation entry they used.
- Mobile form fields and comboboxes across the app receive a 44px minimum touch target and 16px text to avoid the narrow-target / iOS zoom pattern. The small child-task add control follows the same target.
- Replaced Settings' hard-coded 75% profile-completion display and unconditional avatar badge with a percentage derived from the two actual editable fields (display name and a non-placeholder email). No completion is attributed to an avatar that the page does not configure.

## Current user-directed navigation and correctness batch

- Phone bottom navigation now exposes the registered Overview, Productivity, Wellness, and Growth categories, plus a separate Settings entry. Each category opens its second-level module list in the main area; selecting a module opens that screen. While the category list is open, the browsed category owns the sole selected/current indicator. Re-selecting it closes the list and returns to the current screen.
- The category lists preserve existing module IDs and enabled-module filtering: Overview (Dashboard); Productivity (Tasks, Projects, Notes, Calendar, Time); Wellness (Habits, Journal); Growth (Goals, Learning, Finance). Settings is a separate personal/settings destination; Accounts remains visible only after the platform session confirms admin role.
- Desktop sidebar now uses the same four user-facing categories; Settings stays at the bottom. This follows the existing `nav.overview`, `nav.productivity`, `nav.wellness`, and `nav.growth` registration strings.
- Task progress copy now explicitly says it is an all-task metric. Dashboard task totals, remaining count, completion percentage, and the displayed unfinished task rows are derived from the same `/api/tasks` response instead of combining dashboard aggregates with a separate task list.
- Task details now read goal, expected artifacts, verification criteria, and next step from the existing task-card API. A failed read has a retry action; no example text is presented as saved task data.
- Four real 390×844 Chromium screenshots with intercepted local fixtures are checked into `artifacts/category-navigation-preview/` for Productivity, Wellness, Growth, and Settings.
- Regression tests cover exclusive bottom-category current semantics, category list close, category-scoped filtering, a three-task metric fixture (1/3 complete), filtering to the next-up queue then opening/closing detail while preserving queue selection and scroll position, unsaved edit navigation, real task-card fields, and task-card load retry.

## Validation scope and limits

- Source inventory: all 13 registered module components, the two setup gates, sidebar group definitions, and header module labels were inspected.
- Browser smoke validation: all 12 modules available to a non-admin session (Dashboard, Tasks, Projects, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, Settings) loaded in the actual Next app under Chromium with local API fixtures. No page errors or app error boundaries appeared. The mobile More navigation and desktop navigation were also visually inspected. These checks validate screen mounting and shell navigation, not every module-specific interaction.
- Browser visual validation: the mobile module directory and task queue at 390px, desktop navigation and Projects at 1440px, Settings on desktop/mobile, and task list/detail/edit (including 390px and 375px), using the actual Next app with locally intercepted API responses. Browser previews use fixture data and do not contact a production account.
- Accounts is role-gated and remained unavailable with the non-admin preview session; authorization was not bypassed. Safari/iOS soft keyboard, VoiceOver, and real device safe-area behavior were not tested in this environment.
- No API, authorization, account data, deployment, or HappySpa surface is changed by this review batch.
