'use client'

import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useTheme } from 'next-themes'
import { apiPath } from '@/lib/api/client'
import {
  decodeCloudAppStateResponse,
  diffAppStatePreferences,
  LatestRequestGuard,
  localizeRemoteAppPreferences,
  readLegacyAppPreferences,
  resolveAppStateConflict,
  selectAppStatePreferences,
  shouldMigrateLegacyPreferences,
  type AppStatePreferences,
  type CloudAppState,
} from '@/lib/app-state-sync'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { CommandPalette } from './command-palette'
import { GlobalSearchPanel } from './global-search-panel'
import { SetupWizard } from './setup/setup-wizard'
import { WelcomeScreen } from './welcome/welcome-screen'
import { DashboardPage } from './dashboard/dashboard-page'
import { TasksPage } from './tasks/tasks-page'
import { ProjectsPage } from './projects/projects-page'
import { NotesPage } from './notes/notes-page'
import { HabitsPage } from './habits/habits-page'
import { JournalPage } from './journal/journal-page'
import { FinancePage } from './finance/finance-page'
import { GoalsPage } from './goals/goals-page'
import { LearningPage } from './learning/learning-page'
import { CalendarPage } from './calendar/calendar-page'
import { TimePage } from './time/time-page'
import { SettingsPage } from './settings/settings-page'
import { KeyboardShortcutsHelp, useKeyboardShortcuts } from './keyboard-shortcuts'
import { FocusModeOverlay } from './focus-mode-overlay'
import { motion, AnimatePresence } from 'framer-motion'
import { useIsMobile } from '@/hooks/use-mobile'

const moduleComponents: Record<string, React.ComponentType> = {
  dashboard: DashboardPage,
  tasks: TasksPage,
  projects: ProjectsPage,
  notes: NotesPage,
  habits: HabitsPage,
  journal: JournalPage,
  finance: FinancePage,
  goals: GoalsPage,
  learning: LearningPage,
  calendar: CalendarPage,
  time: TimePage,
  settings: SettingsPage,
}

export function AppShell() {
  const { activeModule, welcomeSeen, setupComplete, focusMode } = useAppStore()
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const [cloudState, setCloudState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cloudError, setCloudError] = useState('')
  const [saveError, setSaveError] = useState(false)
  const [saveConflict, setSaveConflict] = useState(false)
  const isMobile = useIsMobile()
  const { setTheme: setNextTheme } = useTheme()
  const latestRequest = useRef(new LatestRequestGuard())
  const [legacyPreferences] = useState<AppStatePreferences | null>(() => (
    typeof window === 'undefined' ? null : readLegacyAppPreferences(window.localStorage.getItem('lifeos-app-store'))
  ))
  const cloudInitialized = useRef(false)
  const revision = useRef<string | null>(null)
  const lastSyncedPreferences = useRef<AppStatePreferences>({})
  const conflictPreferences = useRef<string[]>([])
  const retrySave = useRef<(() => void) | null>(null)

  const requestCloudState = async (signal: AbortSignal): Promise<CloudAppState> => {
    const response = await fetch(apiPath('/api/app-state'), { signal, cache: 'no-store' })
    return decodeCloudAppStateResponse(response)
  }

  const applyCloudState = (state: CloudAppState, preserve?: AppStatePreferences) => {
    const preferences = { ...localizeRemoteAppPreferences(state), ...preserve }
    const allowed: Record<string, unknown> = {}
    for (const key of [
      'setupComplete', 'language', 'accentColor', 'fontSize', 'theme', 'dashboardWidgets',
      'uiDensity', 'animationsEnabled', 'themeVariant', 'customAccentColor', 'baseCurrency',
      'currencyConverterEnabled', 'enabledModules', 'sidebarCollapsed',
    ]) {
      if (preferences[key] !== undefined) allowed[key] = preferences[key]
    }
    const complete = state.setupComplete || allowed.setupComplete === true
    useAppStore.setState({
      ...allowed,
      setupComplete: complete,
      welcomeSeen: complete ? true : useAppStore.getState().welcomeSeen,
    } as never)
    if (typeof allowed.theme === 'string') setNextTheme(allowed.theme)
  }

  const loadCloudState = async () => {
    const generation = latestRequest.current.begin()
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    setCloudState('loading')
    setCloudError('')
    try {
      let state = await requestCloudState(controller.signal)
      if (!latestRequest.current.isCurrent(generation)) return
      const legacy = legacyPreferences
      if (shouldMigrateLegacyPreferences(state, legacy)) {
        const migration = await fetch(apiPath('/api/app-state'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({ expectedRevision: state.revision, legacyMigration: true, preferences: legacy }),
        })
        if (migration.status === 409) {
          state = await requestCloudState(controller.signal)
          if (!state.preferencesVersion) {
            const retry = await fetch(apiPath('/api/app-state'), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
              body: JSON.stringify({ expectedRevision: state.revision, legacyMigration: true, preferences: legacy }),
            })
            state = await decodeCloudAppStateResponse(retry)
          }
        } else {
          state = await decodeCloudAppStateResponse(migration)
        }
      }
      if (!latestRequest.current.isCurrent(generation)) return
      cloudInitialized.current = state.initialized
      revision.current = state.revision
      lastSyncedPreferences.current = {
        ...localizeRemoteAppPreferences(state),
        setupComplete: state.setupComplete,
      }
      applyCloudState(state)
      setCloudState('ready')
    } catch (error) {
      if (!latestRequest.current.isCurrent(generation)) return
      setCloudError(error instanceof Error && error.name === 'AbortError'
        ? 'Cloud setup is taking too long. Check your connection and retry.'
        : 'Could not load your cloud setup. Your saved data is untouched; retry when connected.')
      setCloudState('error')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  useEffect(() => {
    void loadCloudState()
    return () => { latestRequest.current.begin() }
    // The cloud bootstrap is a one-time gate; retry is triggered by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist only user changes made after cloud hydration. A new blank account
  // stays local until setup successfully creates its profile/widgets.
  useEffect(() => {
    if (cloudState !== 'ready') return
    let pending: AppStatePreferences = {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let suppressStoreChanges = false

    const flush = async () => {
      if (disposed || !Object.keys(pending).length) return
      const patch = pending
      pending = {}
      let retryPatch = patch
      try {
        let response = await fetch(apiPath('/api/app-state'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ expectedRevision: revision.current, preferences: patch }),
        })
        if (response.status === 409) {
          const latest = await requestCloudState(new AbortController().signal)
          revision.current = latest.revision
          const concurrentLocalChanges = pending
          pending = {}
          const cloudPreferences = {
            ...localizeRemoteAppPreferences(latest),
            setupComplete: latest.setupComplete,
          }
          const resolution = resolveAppStateConflict(
            lastSyncedPreferences.current,
            { ...patch, ...concurrentLocalChanges },
            cloudPreferences,
          )
          retryPatch = resolution.retry
          conflictPreferences.current = resolution.conflicts
          lastSyncedPreferences.current = cloudPreferences
          setSaveConflict(resolution.conflicts.length > 0)
          suppressStoreChanges = true
          applyCloudState(latest, retryPatch)
          suppressStoreChanges = false
          if (!Object.keys(retryPatch).length) {
            setSaveError(false)
            return
          }
          response = await fetch(apiPath('/api/app-state'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ expectedRevision: revision.current, preferences: retryPatch }),
          })
        }
        const saved = await decodeCloudAppStateResponse(response)
        revision.current = saved.revision
        cloudInitialized.current = saved.initialized
        lastSyncedPreferences.current = {
          ...lastSyncedPreferences.current,
          ...localizeRemoteAppPreferences(saved),
          setupComplete: saved.setupComplete,
        }
        setSaveError(false)
      } catch {
        pending = { ...retryPatch, ...pending }
        setSaveError(true)
      }
    }
    retrySave.current = () => { if (timer) clearTimeout(timer); void flush() }
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (suppressStoreChanges) return
      const completingSetup = next.setupComplete === true && previous.setupComplete !== true
      // A configured account may be completing setup on a new device. Keep
      // wizard defaults local until the user finishes; only then upload the
      // explicit setup snapshot.
      if ((!cloudInitialized.current || next.setupComplete !== true) && !completingSetup) return
      const changed = completingSetup
        ? selectAppStatePreferences(next as unknown as Record<string, unknown>)
        : diffAppStatePreferences(next as unknown as Record<string, unknown>, previous as unknown as Record<string, unknown>)
      if (conflictPreferences.current.length) {
        conflictPreferences.current = conflictPreferences.current.filter(key => !Object.hasOwn(changed, key))
        setSaveConflict(conflictPreferences.current.length > 0)
      }
      pending = { ...pending, ...changed }
      if (!Object.keys(pending).length) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, 500)
    })
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      unsubscribe()
      retrySave.current = null
    }
    // Install the store listener only after the initial cloud snapshot was applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudState])

  // Register global keyboard shortcuts
  useKeyboardShortcuts()

  // Listen for the custom event from keyboard shortcuts
  useEffect(() => {
    const handler = () => setShortcutsHelpOpen(true)
    window.addEventListener('lifeos:show-shortcuts', handler)
    return () => window.removeEventListener('lifeos:show-shortcuts', handler)
  }, [])

  if (cloudState !== 'ready') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Life OS</h1>
          {cloudState === 'loading' ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading your cloud setup…</p>
          ) : (
            <>
              <p role="alert" className="mt-3 text-sm text-muted-foreground">{cloudError}</p>
              <button type="button" className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => void loadCloudState()}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (!setupComplete && !welcomeSeen) {
    return <WelcomeScreen />
  }
  if (!setupComplete) {
    return <SetupWizard />
  }

  const ActiveComponent = moduleComponents[activeModule] || DashboardPage

  // Page transition variants
  const pageVariants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  }

  return (
    <div className="lifeos-workspace bg-background">
      {saveError && <div role="alert" className="fixed bottom-3 right-3 z-[100] rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
        Cloud preferences have not synced. <button className="ml-2 underline" onClick={() => retrySave.current?.()}>Retry</button>
      </div>}
      {saveConflict && <div role="status" className="fixed bottom-3 left-3 z-[100] rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
        Another device changed the same preference. The cloud value was kept; change it again to replace it.
      </div>}
      <div className="lifeos-frame">
        {/* Desktop sidebar — hidden on mobile */}
        {!focusMode && !isMobile && <Sidebar />}

        <div className="lifeos-column">
          {!focusMode && <Header />}
          <main className="lifeos-main relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeModule}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full"
              >
                <ActiveComponent />
              </motion.div>
            </AnimatePresence>
            {focusMode && <FocusModeOverlay />}
          </main>
        </div>
      </div>

      {/* Mobile sidebar Sheet — rendered outside the layout flow */}
      {!focusMode && isMobile && <Sidebar />}

      <CommandPalette />
      <GlobalSearchPanel />
      <KeyboardShortcutsHelp open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
    </div>
  )
}
