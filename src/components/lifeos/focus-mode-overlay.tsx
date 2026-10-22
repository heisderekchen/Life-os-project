'use client'

import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'

import { useAppStore } from '@/stores/app-store'
import { Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function FocusModeOverlay() {
  useInterfaceLanguage()
  const { focusMode, toggleFocusMode, activeModule } = useAppStore()

  if (!focusMode) return null

  const moduleLabels: Record<string, string> = {
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    projects: 'Projects',
    notes: 'Notes',
    habits: 'Habits',
    journal: 'Journal',
    finance: 'Finance',
    goals: 'Goals',
    learning: 'Learning',
    calendar: 'Calendar',
    time: 'Time Tracker',
    settings: 'Settings',
  }

  return (
    <div role="toolbar" aria-label={uiText('Focus Mode')} className="flex min-h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 py-0.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="shrink-0 font-medium">{uiText('Focus Mode')}</span>
        <span className="truncate text-muted-foreground">{uiText(moduleLabels[activeModule] || 'Dashboard')}</span>
      </div>
      <Button variant="ghost" size="sm" onClick={toggleFocusMode} className="h-8 min-h-11 shrink-0 sm:min-h-8 [@media(pointer:coarse)]:min-h-11 gap-1.5 text-xs" title={`${uiText('Exit Focus')} (Esc)`}>
        <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
        {uiText('Exit Focus')}
        <kbd className="ml-1 hidden text-xs text-muted-foreground sm:inline">Esc</kbd>
      </Button>
    </div>
  )
}
