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

1. **Make frequent navigation easy on phones.** Keep Dashboard, Tasks, and Projects in a persistent four-slot bottom bar; put all remaining modules in the existing navigation sheet under named groups. Preserve the existing profile and settings entry points. Reserve layout space for both the bar and fixed task form actions.
2. **Keep the desktop rail legible without letting it dominate.** Keep Overview and Productivity visible, group Wellness, Growth, and Administration behind keyboard-operable native disclosure controls, retain Settings at the bottom, and mark the active module semantically.
3. **Give content pages a common heading and action rhythm.** Use one responsive heading component for title, supporting text, and the primary action. Apply it to Projects and Settings first; retain their module-specific controls and screens.
4. **Review every module's content and state patterns.** After shell adoption, inspect title/action placement, mobile overflow, loading/empty/error states, form feedback, keyboard return, and bilingual labels across Dashboard, Tasks, Projects, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, Settings, and the role-gated Accounts screen. Repair by screen in follow-up commits without changing APIs, authorization, persisted data, or business behavior.

## This change batch

- Added a mobile primary nav for Dashboard, Tasks, Projects, and More. More opens the existing complete navigation sheet. The sheet keeps every module, including Settings; role-gated Accounts remains role-gated.
- Removed the duplicate hamburger from the mobile header after adding More, leaving the active module breadcrumb and existing search, language, quick-add, notification, and profile controls.
- Kept Overview and Productivity visible in the sidebar. Wellness, Growth, and Administration now use native `details` disclosure groups when the rail is expanded. The collapsed desktop rail still exposes all module icons.
- Added `ModulePageHeader` and applied it to Projects and Settings. Project filters, search, and primary create action meet the 44px touch target design target; settings tabs become a horizontally scrollable row on narrow screens and remain a vertical rail on larger screens.
- The task edit workspace now uses a separate bottom action area, so the content scroller ends above Return/Save controls and inputs do not scroll underneath them.
- The global store emits a cancellable pre-navigation event before changing modules. An edited task can prevent navigation when the user declines the unsaved-changes prompt, regardless of which app navigation entry they used.
- Mobile form fields and comboboxes across the app receive a 44px minimum touch target and 16px text to avoid the narrow-target / iOS zoom pattern. The small child-task add control follows the same target.
- Replaced Settings' hard-coded 75% profile-completion display and unconditional avatar badge with a percentage derived from the two actual editable fields (display name and a non-placeholder email). No completion is attributed to an avatar that the page does not configure.

## Validation scope and limits

- Source inventory: all 13 registered module components, the two setup gates, sidebar group definitions, and header module labels were inspected.
- Browser visual validation: task list/detail/edit (including 390px and 375px), Projects, and Settings in Chromium using the actual Next app and locally intercepted API responses. Browser previews use fixture data and do not contact a production account.
- The entire module set has not yet received individual interaction and visual regression checks. Dashboard, Notes, Calendar, Time, Habits, Journal, Goals, Learning, Finance, and Accounts remain to be exercised module by module. Safari/iOS soft keyboard, VoiceOver, and real device safe-area behavior were not tested in this environment.
- No API, authorization, account data, deployment, or HappySpa surface is changed by this review batch.
