'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  StickyNote,
  Timer,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAppStore, type ModuleId } from '@/stores/app-store'
import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'
import { useTranslation } from '@/lib/i18n'

type DirectoryModule = { id: ModuleId; label: string; icon: LucideIcon }
type DirectoryGroup = { title: string; items: DirectoryModule[] }

export function MobileModuleDirectory({ onSelect }: { onSelect: (module: ModuleId) => void }) {
  useInterfaceLanguage()
  const { t } = useTranslation()
  const enabledModules = useAppStore((state) => state.enabledModules)
  const [query, setQuery] = useState('')
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/platform/session', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((session) => { if (active) setIsPlatformAdmin(session?.principal?.role === 'platform_admin') })
      .catch(() => { if (active) setIsPlatformAdmin(false) })
    return () => { active = false }
  }, [])

  const groups = useMemo<DirectoryGroup[]>(() => {
    const dashboard: DirectoryModule = { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard }
    const tasks: DirectoryModule = { id: 'tasks', label: t('nav.tasks'), icon: CheckSquare }
    const projects: DirectoryModule = { id: 'projects', label: t('nav.projects'), icon: FolderKanban }
    const notes: DirectoryModule = { id: 'notes', label: t('nav.notes'), icon: StickyNote }
    const calendar: DirectoryModule = { id: 'calendar', label: t('nav.calendar'), icon: CalendarDays }
    const time: DirectoryModule = { id: 'time', label: t('nav.timeTracker'), icon: Timer }
    const habits: DirectoryModule = { id: 'habits', label: t('nav.habits'), icon: Repeat }
    const journal: DirectoryModule = { id: 'journal', label: t('nav.journal'), icon: BookOpen }
    const goals: DirectoryModule = { id: 'goals', label: t('nav.goals'), icon: Target }
    const learning: DirectoryModule = { id: 'learning', label: t('nav.learning'), icon: GraduationCap }
    const finance: DirectoryModule = { id: 'finance', label: t('nav.finance'), icon: Wallet }
    const settings: DirectoryModule = { id: 'settings', label: t('nav.settings'), icon: Settings }
    const workItems = [notes, calendar, time]
    const lifeItems = [habits, journal, goals, learning, finance]
    const groups: DirectoryGroup[] = [
      { title: uiText('Common'), items: [dashboard, tasks, projects] },
      { title: uiText('Work'), items: workItems },
      { title: uiText('Life'), items: lifeItems },
      { title: uiText('Settings'), items: [settings] },
    ]
    if (isPlatformAdmin) groups[3].items.push({ id: 'accounts', label: t('nav.accounts'), icon: ShieldCheck })
    return groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id === 'dashboard' || item.id === 'projects' || item.id === 'settings' || item.id === 'accounts' || enabledModules.includes(item.id)),
    })).filter((group) => group.items.length > 0)
  }, [enabledModules, isPlatformAdmin, t])

  const visibleGroups = query.trim()
    ? groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
    })).filter((group) => group.items.length > 0)
    : groups

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 pb-8 pt-5 sm:px-8 sm:pt-8">
      <div className="mb-6 border-b border-border/70 pb-5 sm:mb-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Life OS</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{uiText('Where do you want to go?')}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{uiText('Choose a place by what you want to do next.')}</p>
        <label className="relative mt-5 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Find a tool')} aria-label={uiText('Find a tool')} className="h-11 pl-9 text-base" />
        </label>
      </div>

      <div className="space-y-7 sm:space-y-8">
        {visibleGroups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <div className="mb-2 flex items-baseline justify-between border-b border-border/60 pb-2">
              <h2 className="text-sm font-semibold tracking-wide">{group.title}</h2>
              <span className="text-xs text-muted-foreground">{group.items.length}</span>
            </div>
            <div>
              {group.items.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => onSelect(id)} className="group flex min-h-14 w-full items-center gap-3 border-b border-border/40 px-1 text-left transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-foreground/80"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </button>
              ))}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{uiText('No tools match your search.')}</p>}
      </div>
    </div>
  )
}
