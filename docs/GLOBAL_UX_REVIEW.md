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

## Highest-value changes

1. **Make phone navigation a destination of its own.** Keep Dashboard, Tasks, and Projects in the bottom bar. More opens a full-height module directory in the app's main area, organized as Common, Work, Life, and Settings, with search and all authorized modules reachable without a side drawer.
2. **Group the desktop rail around work flow.** Keep Plan and Do visible, place Life modules in a keyboard-operable disclosure group, retain Settings at the bottom, and mark the active module semantically.
3. **Give content pages a common heading and action rhythm.** Use one responsive heading component for title, supporting text, and the primary action. Apply it to Projects and Settings first; retain their module-specific controls and screens.
4. **Review every module's content and state patterns.** After shell adoption, inspect title/action placement, mobile overflow, loading/empty/error states, form feedback, keyboard return, and bilingual labels across Dashboard, Tasks, Projects, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, Settings, and the role-gated Accounts screen. Repair by screen in follow-up commits without changing APIs, authorization, persisted data, or business behavior.

## This change batch

- Added a mobile primary nav for Dashboard, Tasks, Projects, and More. More opens an independent, searchable module directory in the main content area; it is not the desktop sidebar in a sheet. The directory groups Common, Work, Life, and Settings; role-gated Accounts remains role-gated.
- Removed the duplicate hamburger from the mobile header after adding More, leaving the active module breadcrumb and existing search, language, quick-add, notification, and profile controls.
- Reorganized desktop navigation as Plan (Dashboard, Projects, Calendar, Goals), Do (Tasks, Notes, Time), and Life (Habits, Journal, Learning, Finance). Plan and Do remain visible; Life uses a native `details` disclosure. The collapsed desktop rail still exposes all module icons.
- Added `ModulePageHeader` and applied it to Projects and Settings. Project filters, search, and primary create action meet the 44px touch target design target; settings tabs become a horizontally scrollable row on narrow screens and remain a vertical rail on larger screens.
- The task edit workspace now uses a separate bottom action area, so the content scroller ends above Return/Save controls and inputs do not scroll underneath them.
- Replaced the task status-chip row with a prominent, low-box-count work queue: In progress, Needs attention (overdue), Next up, and All tasks. Fine-grained status filters remain available in a disclosure.
- The global store emits a cancellable pre-navigation event before changing modules. An edited task can prevent navigation when the user declines the unsaved-changes prompt, regardless of which app navigation entry they used.
- Mobile form fields and comboboxes across the app receive a 44px minimum touch target and 16px text to avoid the narrow-target / iOS zoom pattern. The small child-task add control follows the same target.
- Replaced Settings' hard-coded 75% profile-completion display and unconditional avatar badge with a percentage derived from the two actual editable fields (display name and a non-placeholder email). No completion is attributed to an avatar that the page does not configure.

## Validation scope and limits

- Source inventory: all 13 registered module components, the two setup gates, sidebar group definitions, and header module labels were inspected.
- Browser smoke validation: all 12 modules available to a non-admin session (Dashboard, Tasks, Projects, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, Settings) loaded in the actual Next app under Chromium with local API fixtures. No page errors or app error boundaries appeared. The mobile More navigation and desktop navigation were also visually inspected. These checks validate screen mounting and shell navigation, not every module-specific interaction.
- Browser visual validation: the mobile module directory and task queue at 390px, desktop navigation and Projects at 1440px, Settings on desktop/mobile, and task list/detail/edit (including 390px and 375px), using the actual Next app with locally intercepted API responses. Browser previews use fixture data and do not contact a production account.
- Accounts is role-gated and remained unavailable with the non-admin preview session; authorization was not bypassed. Safari/iOS soft keyboard, VoiceOver, and real device safe-area behavior were not tested in this environment.
- No API, authorization, account data, deployment, or HappySpa surface is changed by this review batch.
