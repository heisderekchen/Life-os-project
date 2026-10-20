'use client'

import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'

import { useEffect, useMemo, useState } from 'react'
import { useAppStore, type ModuleId } from '@/stores/app-store'
import { useTaskStore } from '@/stores/task-store'
import { useTranslation } from '@/lib/i18n'
import { apiPath } from '@/lib/api/client'
import {
  LayoutDashboard,
  Bell,
  FolderKanban,
  StickyNote,
  Repeat,
  BookOpen,
  Wallet,
  Target,
  GraduationCap,
  CalendarDays,
  Timer,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Maximize2,
  ShieldCheck,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { WorkspaceSwitcher, useGrantedWorkspaces } from '@/components/lifeos/myos/workspace-switcher'

// These are core entry points, not optional setup-wizard apps. Keeping the
// bench here makes a newly shipped read-only safety surface visible to people
// whose persisted module list predates it, without changing that preference.
const ALWAYS_VISIBLE_MODULE_IDS: ModuleId[] = ['accounts', 'dashboard', 'myos', 'reminders', 'projects', 'happyspa-bench']

function WorkspaceLinks() {
  const { workspaces, status } = useGrantedWorkspaces()
  const { t } = useTranslation()
  const authorized = workspaces.filter(workspace => workspace.kind !== 'lifeos')
  if (status === 'loading') return <p className="px-2 py-2 text-xs text-muted-foreground">{t('nav.loadingWorkspaces')}</p>
  if (status === 'error') return <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{t('nav.workspacesUnavailable')}</p>
  if (!authorized.length) return <p className="px-2 py-2 text-xs text-muted-foreground">{t('nav.noOtherWorkspaces')}</p>
  return <div className="space-y-px">{authorized.slice(0, 3).map(workspace => <a key={workspace.workspaceId} href={`/workspace/${encodeURIComponent(workspace.slug)}`} className="flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground" title={workspace.displayName}>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">{workspace.displayName.slice(0, 1)}</span>
    <span className="truncate">{workspace.displayName}</span>
  </a>)}</div>
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const { activeModule, setActiveModule, setMobileSidebarOpen, enabledModules } = useAppStore()
  const { t, language } = useTranslation()
  const [projects, setProjects] = useState<{ id?: string; name?: string; archived?: boolean }[]>([])
  const [projectsStatus, setProjectsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [appsOpen, setAppsOpen] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/platform/session', { cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(session => { if (active) setIsPlatformAdmin(session?.principal?.role === 'platform_admin') })
      .catch(() => { if (active) setIsPlatformAdmin(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    fetch(apiPath('/api/projects'), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`)
        const value = await response.json() as unknown
        if (active) {
          setProjects(Array.isArray(value) ? value as { id?: string; name?: string; archived?: boolean }[] : [])
          setProjectsStatus('ready')
        }
      })
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return
        if (active) { setProjects([]); setProjectsStatus('error') }
      })
    return () => { active = false; controller.abort() }
  }, [])

  const navSections = useMemo(() => [
    {
      title: t('nav.workbench'),
      items: [
        { id: 'dashboard' as ModuleId, label: t('nav.overview'), icon: LayoutDashboard },
        { id: 'reminders' as ModuleId, label: t('nav.attention'), icon: Bell },
      ],
    },
    {
      title: t('nav.projects'),
      items: [
        { id: 'projects' as ModuleId, label: language === 'zh' ? '项目与任务' : 'Projects & tasks', icon: FolderKanban },
      ],
    },
    {
      title: t('nav.appsChannels'),
      items: [
        { id: 'myos' as ModuleId, label: t('nav.myos'), icon: LayoutDashboard },
        { id: 'notes' as ModuleId, label: t('nav.notes'), icon: StickyNote },
        { id: 'calendar' as ModuleId, label: t('nav.calendar'), icon: CalendarDays },
        { id: 'time' as ModuleId, label: t('nav.timeTracker'), icon: Timer },
        { id: 'habits' as ModuleId, label: t('nav.habits'), icon: Repeat },
        { id: 'journal' as ModuleId, label: t('nav.journal'), icon: BookOpen },
        { id: 'goals' as ModuleId, label: t('nav.goals'), icon: Target },
        { id: 'learning' as ModuleId, label: t('nav.learning'), icon: GraduationCap },
        { id: 'finance' as ModuleId, label: t('nav.finance'), icon: Wallet },
        { id: 'happyspa-bench' as ModuleId, label: 'HappyspaBench', icon: Activity },
      ],
    },
  ], [t])

  const visibleSections = isPlatformAdmin
    ? [...navSections, { title: t('nav.administration'), items: [{ id: 'accounts' as ModuleId, label: t('nav.accounts'), icon: ShieldCheck }] }]
    : navSections

  const handleNav = (id: ModuleId) => {
    setActiveModule(id)
    setMobileSidebarOpen(false)
  }

  const filteredSections = visibleSections.map(section => ({
    ...section,
    items: section.items.filter(item => ALWAYS_VISIBLE_MODULE_IDS.includes(item.id) || enabledModules.includes(item.id))
  })).filter(section => section.items.length > 0)

  return (
    <div className="flex flex-col h-full">
      {/* Logo / workspace */}
      <div className={cn(
        'flex items-center h-12 px-4 shrink-0 border-b border-border',
        collapsed && 'justify-center px-2'
      )}>
        {collapsed ? (
          <img src={`${process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH || ''}/logo.svg`} alt="myOS" className="w-7 h-7 rounded-md" />
        ) : (
          <div className="flex items-center gap-2">
            <img src={`${process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH || ''}/logo.svg`} alt="" aria-hidden className="w-6 h-6 rounded-md shrink-0" />
            <span className="text-sm font-semibold tracking-tight">{t('appName')}</span>
          </div>
        )}
      </div>

      {!collapsed ? <div className="px-2 pt-3"><WorkspaceSwitcher /></div> : null}

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3">
        <nav className="px-2 space-y-4">
          <TooltipProvider delayDuration={0}>
            {filteredSections.map((section) => {
              const primaryGroup = section.title === t('nav.workbench') || section.title === t('nav.projects') || section.title === t('nav.administration')
              const activeInSection = section.items.some(item => item.id === activeModule)
              const links = (
                <div className="space-y-px">
                  {section.items.map((mod) => {
                    const isActive = activeModule === mod.id
                    const Icon = mod.icon
                    const btn = (
                      <button
                        key={mod.id}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => handleNav(mod.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 rounded-md text-sm transition-colors duration-150',
                          collapsed ? 'justify-center px-2 py-2' : 'min-h-11 px-2 py-2',
                          isActive ? 'font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                        )}
                        style={isActive ? {
                          color: 'var(--accent-primary)',
                          backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
                        } : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{mod.label}</span>}
                      </button>
                    )
                    return collapsed ? (
                      <Tooltip key={mod.id}><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent side="right">{mod.label}</TooltipContent></Tooltip>
                    ) : btn
                  })}
                </div>
              )
              if (collapsed || primaryGroup) return <div key={section.title}>
                {!collapsed && <p className="px-2 mb-1 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">{section.title}</p>}
                {links}
              </div>
              return (
                <details key={section.title} className="group/nav rounded-md" open={appsOpen || activeInSection} onToggle={event => setAppsOpen(event.currentTarget.open)}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-accent/50 hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span>{section.title}</span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/nav:rotate-180" />
                  </summary>
                  <div className="mt-1 space-y-px pl-2">{links}</div>
                </details>
              )
            })}
          </TooltipProvider>

          {!collapsed ? <div className="pt-1">
            <div className="mb-1 flex min-h-7 items-center justify-between px-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{t('nav.projectList')}</p>
              <button type="button" className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { useTaskStore.getState().setSelectedProjectId('__all__'); handleNav('projects') }}>全部</button>
            </div>
            {projectsStatus === 'loading' ? <p className="px-2 py-2 text-xs text-muted-foreground">正在读取项目…</p>
              : projectsStatus === 'error' ? <p role="status" className="px-2 py-2 text-xs text-muted-foreground">项目暂不可用</p>
                : projects.filter(project => !project.archived).slice(0, 4).map((project, index) => <button key={project.id || project.name} type="button" onClick={() => { useTaskStore.getState().setSelectedProjectId(project.id || null); handleNav('projects') }} className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground" title={project.name || ''}>
                  <span className={cn('h-2 w-2 shrink-0 rounded-[3px]', ['bg-emerald-500', 'bg-amber-500', 'bg-blue-500', 'bg-violet-500'][index % 4])} />
                  <span className="truncate">{project.name || '未命名项目'}</span>
                </button>)}
            {projectsStatus === 'ready' && projects.filter(project => !project.archived).length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">还没有项目</p> : null}
          </div> : null}

          {!collapsed ? <div className="pt-1">
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{t('nav.otherWorkspaces')}</p>
            <WorkspaceLinks />
          </div> : null}
        </nav>
      </ScrollArea>

      {/* Bottom actions */}
      <div className="shrink-0 border-t border-border p-2 space-y-px">
        <TooltipProvider delayDuration={0}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => useAppStore.getState().toggleFocusMode()}
                  className="w-full flex items-center justify-center px-2 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('nav.focusMode')}</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => useAppStore.getState().toggleFocusMode()}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors duration-150"
            >
              <Maximize2 className="h-4 w-4 shrink-0" />
              <span>{t('nav.focusMode')}</span>
            </button>
          )}

          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleNav('settings')}
                  className={cn(
                    'w-full flex items-center justify-center px-2 py-2 rounded-md transition-colors duration-150',
                    activeModule === 'settings'
                      ? ''
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                  )}
                  style={activeModule === 'settings' ? { color: 'var(--accent-primary)', backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' } : undefined}
                >
                  <Settings className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t('nav.settings')}</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => handleNav('settings')}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors duration-150',
                activeModule === 'settings'
                  ? 'font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
              style={activeModule === 'settings' ? { color: 'var(--accent-primary)', backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' } : undefined}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>{t('nav.settings')}</span>
            </button>
          )}
        </TooltipProvider>
      </div>
    </div>
  )
}

export function Sidebar() {
  useInterfaceLanguage()
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useAppStore()
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent side="left" className="lifeos-safe-bottom w-[min(20rem,88vw)] p-0 bg-background pt-[env(safe-area-inset-top)]">
          <SheetHeader className="sr-only">
            <SheetTitle>{uiText("Navigation")}</SheetTitle>
          </SheetHeader>
          <SidebarContent collapsed={false} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      className={cn(
        'relative h-full min-h-0 border-r border-border bg-background transition-all duration-200 shrink-0',
        sidebarCollapsed ? 'w-[52px]' : 'w-[248px]'
      )}
    >
      <SidebarContent collapsed={sidebarCollapsed} />
      <Button
        variant="ghost"
        size="icon"
        className="absolute -right-3 top-16 z-10 h-6 w-6 rounded-full border border-border bg-background shadow-sm hover:bg-accent"
        onClick={toggleSidebar}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronLeft className="h-3 w-3" />
        )}
      </Button>
    </aside>
  )
}
