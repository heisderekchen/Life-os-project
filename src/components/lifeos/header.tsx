'use client'

import { useAppStore, type ModuleId } from '@/stores/app-store'
import {
  Search,
  Sun,
  Moon,
  Plus,
  Menu,
  Command,
  CheckSquare,
  StickyNote,
  BookOpen,
  ChevronRight,
  User,
  Settings,
  LogOut,
  Maximize2,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { useIsMobile } from '@/hooks/use-mobile'
import { NotificationCenter } from '@/components/lifeos/notification-center'
import { useTranslation } from '@/lib/i18n'
import { useProfile } from '@/lib/api/hooks'
import { showToast } from '@/lib/toast'

export function Header() {
  const { activeModule, setCommandPaletteOpen, setMobileSidebarOpen, setGlobalSearchOpen, setActiveModule, toggleFocusMode, language, setLanguage } = useAppStore()
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const { t } = useTranslation()
  const { data: profile } = useProfile()

  const moduleLabels: Record<ModuleId, string> = {
    dashboard: t('nav.dashboard'),
    tasks: t('nav.tasks'),
    projects: t('nav.projects'),
    notes: t('nav.notes'),
    habits: t('nav.habits'),
    journal: t('nav.journal'),
    finance: t('nav.finance'),
    goals: t('nav.goals'),
    learning: t('nav.learning'),
    calendar: t('nav.calendar'),
    time: t('nav.timeTracker'),
    settings: t('nav.settings'),
  }

  const moduleGroups: Record<ModuleId, string> = {
    dashboard: t('groups.home'),
    tasks: t('groups.productivity'),
    projects: t('groups.productivity'),
    notes: t('groups.productivity'),
    habits: t('groups.wellness'),
    journal: t('groups.wellness'),
    finance: t('groups.growth'),
    goals: t('groups.growth'),
    learning: t('groups.growth'),
    calendar: t('groups.productivity'),
    time: t('groups.productivity'),
    settings: t('groups.settings'),
  }

  const userName = profile?.name || ''
  const userEmail = profile?.email || ''
  const isPrivateWorkbench = process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH === '/workbench'

  const signOut = async () => {
    try {
      // Session management is mounted at the Worker root, outside the Life OS
      // `/workbench/api/*` compatibility prefix used for D1-backed module APIs.
      const response = await fetch('/api/personal-workbench/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('Could not end the private session')
      window.location.replace('/workbench?login=1')
    } catch {
      showToast.error(t('toast.error'), t('toast.somethingWentWrong'))
    }
  }

  const initials = userName
    ? userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  const displayName = userName || 'User'

  return (
    <header className="min-h-14 sm:min-h-12 z-30 bg-background/95 border-b border-border flex items-center justify-between px-2 sm:px-4 gap-1.5 sm:gap-4 shrink-0 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      {/* Left — breadcrumb */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            aria-label={t('header.openNavigation')}
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap whitespace-nowrap overflow-hidden">
            <BreadcrumbItem>
              <BreadcrumbLink
                className="cursor-pointer text-muted-foreground hover:text-foreground text-sm transition-colors hidden sm:inline"
                onClick={() => setActiveModule('dashboard')}
              >
                {t('appName')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:flex">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
            </BreadcrumbSeparator>
            {activeModule !== 'dashboard' ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink className="text-muted-foreground/60 text-sm hidden sm:inline">
                    {moduleGroups[activeModule]}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:flex">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-sm font-medium">
                    {moduleLabels[activeModule]}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage className="text-sm font-medium">
                  {t('nav.dashboard')}
                </BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Center — search */}
      {!isMobile && (
        <div className="flex-1 max-w-sm">
          <button
            onClick={() => setGlobalSearchOpen(true)}
            className="flex items-center gap-2 w-full h-8 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted/70 transition-colors"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">{t('header.searchEverything')}</span>
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] text-muted-foreground">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>
        </div>
      )}

      {/* Right */}
      <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-10 min-w-10 sm:min-w-[88px] shrink-0 px-2 text-xs" aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'} title={language === 'zh' ? '切换到 English' : 'Switch to 中文'} onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}><span className="sm:hidden">{language === 'zh' ? '中' : 'EN'}</span><span className="hidden sm:inline">中文 / English</span></Button>
        {isMobile && (
          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t('header.searchEverything')} onClick={() => setGlobalSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
        )}

        {/* Quick add */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t('header.quickCreate')}>
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('header.quickCreate')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { setActiveModule('tasks'); setCommandPaletteOpen(true) }}>
              <CheckSquare className="h-4 w-4 mr-2" />
              {t('header.newTask')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setActiveModule('notes'); setCommandPaletteOpen(true) }}>
              <StickyNote className="h-4 w-4 mr-2" />
              {t('header.newNote')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setActiveModule('journal'); setCommandPaletteOpen(true) }}>
              <BookOpen className="h-4 w-4 mr-2" />
              {t('header.newJournalEntry')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label={t('header.focusMode')}
            onClick={toggleFocusMode}
            title={`${t('header.focusMode')} (F11)`}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}

        <NotificationCenter />

        {/* User avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-10 min-w-10 px-1.5 gap-1.5 rounded-md hover:bg-accent/60" aria-label={t('header.profile')}>
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[10px] font-semibold bg-foreground text-background">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!isMobile && (
                <span className="text-sm hidden sm:inline max-w-[80px] truncate">{displayName}</span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{userEmail || 'user@example.com'}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => useAppStore.getState().setActiveModule('settings')}>
              <User className="mr-2 h-4 w-4" />
              {t('header.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => useAppStore.getState().setActiveModule('settings')}>
              <Settings className="mr-2 h-4 w-4" />
              {t('header.preferences')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? (
                <Sun className="mr-2 h-4 w-4" />
              ) : (
                <Moon className="mr-2 h-4 w-4" />
              )}
              {theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isPrivateWorkbench && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {t('header.signOut')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
