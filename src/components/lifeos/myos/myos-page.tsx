'use client'

import { BookOpen, CalendarDays, Dumbbell, FolderKanban, GraduationCap, Settings, StickyNote, Target, Timer, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile } from '@/lib/api/hooks'
import { useAppStore, type ModuleId } from '@/stores/app-store'
import { GrantedWorkspaceList } from './workspace-switcher'

const modules: { id: ModuleId; label: string; icon: typeof FolderKanban }[] = [
  { id: 'projects', label: '项目', icon: FolderKanban },
  { id: 'notes', label: '笔记', icon: StickyNote },
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'time', label: '时间追踪', icon: Timer },
  { id: 'habits', label: '习惯', icon: BookOpen },
  { id: 'fitness', label: '健身', icon: Dumbbell },
  { id: 'journal', label: '日志', icon: BookOpen },
  { id: 'goals', label: '目标', icon: Target },
  { id: 'learning', label: '学习', icon: GraduationCap },
  { id: 'finance', label: '财务', icon: Wallet },
  { id: 'settings', label: '设置', icon: Settings },
]

export function MyOsPage() {
  const profile = useProfile()
  const setActiveModule = useAppStore(state => state.setActiveModule)
  const name = (profile.data?.name || '').trim()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-6 sm:pt-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">myOS</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{name ? `你好，${name}` : '我的空间'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">个人生活与业务工作台的入口。</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">已授权的业务工作台</CardTitle><CardDescription>列表来自当前账号的服务端授权结果。</CardDescription></CardHeader>
        <CardContent><GrantedWorkspaceList /></CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">myOS 模块</CardTitle><CardDescription>个人任务与生活数据仍使用现有 Life OS 页面和存储。</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {modules.map(({ id, label, icon: Icon }) => <Button key={id} variant="outline" className="min-h-11 justify-start gap-2 px-3" onClick={() => setActiveModule(id)}><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span></Button>)}
        </CardContent>
      </Card>
    </div>
  )
}
