'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowRight, Bell, Check, CircleDollarSign, Clock3, FolderKanban, ListChecks, Plus, RefreshCw, RotateCw, Sparkles, Target, TriangleAlert } from 'lucide-react'
import { format, isBefore, startOfDay } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { apiPath } from '@/lib/api/client'
import { useCreateEvent, useDashboard, useEvents, useProjects, useProfile, useRecurringTaskSeries, useTasks, useUpdateEvent, useUpdateTask } from '@/lib/api/hooks'
import { fetchTaskCard, type TaskCard } from '@/components/lifeos/tasks/task-card-panel'
import { useAppStore } from '@/stores/app-store'
import { useGrantedWorkspaces } from '@/components/lifeos/myos/workspace-switcher'

type TaskRecord = {
  id: string
  title: string
  status: string
  priority?: string
  dueDate?: string | null
  recurrence?: string | null
  projectId?: string | null
  project?: { name?: string } | null
  subtasks?: { id: string; title: string; status: string }[]
}
type ReminderRecord = {
  id: string
  title: string
  startDate: string
  completed: boolean
  eventType: string
}
type ResearchSnapshot = {
  rounds?: { status: string; summary?: string | null; createdAt?: string | null }[]
  outbox?: { title: string; status: string; createdAt?: string | null }[]
  executor?: { connected?: boolean; status?: string }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(item => !!item && typeof item === 'object') as Record<string, unknown>[] : []
}

function taskDate(value?: string | null) {
  if (!value) return '未设截止时间'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未设截止时间' : format(date, 'MMM d · HH:mm')
}

function DynamicTaskDetail({ task, projectName }: { task: TaskRecord; projectName: string | null }) {
  const [card, setCard] = useState<TaskCard | null>(null)
  const [research, setResearch] = useState<ResearchSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let active = true
    const researchPath = apiPath(`/api/research/tasks/${encodeURIComponent(task.id)}`)
    Promise.allSettled([
      fetchTaskCard(task.id),
      fetch(researchPath, { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error(`HTTP_${response.status}`)
        return response.json() as Promise<ResearchSnapshot>
      }),
    ]).then(([cardResult, researchResult]) => {
      if (!active) return
      setCard(cardResult.status === 'fulfilled' ? cardResult.value : null)
      setResearch(researchResult.status === 'fulfilled' ? researchResult.value : null)
      setStatus('ready')
    })
    return () => { active = false }
  }, [task.id])

  const subtasks = task.subtasks || []
  const completedSubtasks = subtasks.filter(subtask => subtask.status === 'done').length
  const latestRound = research?.rounds?.[0]
  const latestArtifact = research?.outbox?.[0]
  const progress = subtasks.length ? Math.round(completedSubtasks / subtasks.length * 100) : null

  return (
    <div className="mt-3 border-t border-border/60 pt-2 text-xs">
      {status === 'ready' && (progress !== null || card?.nextStep || latestArtifact) ? <div className="mb-2 space-y-2 rounded-lg bg-muted/35 px-3 py-2.5">
        {progress !== null ? <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground"><span>当前进度 · {completedSubtasks}/{subtasks.length} 步</span><span className="font-medium text-foreground">{progress}%</span></div>
          <div role="progressbar" aria-label={`${task.title} 当前进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1.5 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
        </div> : null}
        {card?.nextStep ? <p className="break-words text-muted-foreground"><span className="font-medium text-foreground">下一步</span> · {card.nextStep}</p> : null}
        {latestArtifact ? <p className="break-words text-primary"><span className="font-medium">最近产物</span> · {latestArtifact.title}</p> : null}
      </div> : null}
      <details>
        <summary className="min-h-11 cursor-pointer content-center rounded-md text-muted-foreground hover:text-foreground">完整计划与执行记录</summary>
        <div className="space-y-2 pb-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <FolderKanban className="h-3.5 w-3.5" />{projectName || '未关联项目'}
            {task.dueDate ? <><span>·</span><Clock3 className="h-3.5 w-3.5" />{taskDate(task.dueDate)}</> : null}
          </p>
          {subtasks.length ? <p className="text-muted-foreground">共 {subtasks.length} 个步骤，已完成 {completedSubtasks} 个</p> : null}
          {status === 'loading' ? <p className="text-muted-foreground">读取现有计划与执行记录…</p> : null}
          {status === 'ready' ? <>
            {card?.goal ? <p className="break-words text-foreground/85">计划：{card.goal}</p> : <p className="text-muted-foreground">尚未保存任务计划。</p>}
            {card?.expectedArtifacts?.length ? <p className="break-words text-muted-foreground">预期产物：{card.expectedArtifacts.join('、')}</p> : null}
            {latestRound ? <p className="break-words text-muted-foreground">最近执行：{latestRound.summary || latestRound.status}{latestRound.createdAt ? ` · ${taskDate(latestRound.createdAt)}` : ''}</p>
              : <p className="text-muted-foreground">暂无可读取的执行记录{research ? '。' : '；研究记录源未接入。'}</p>}
            {latestArtifact ? <p className="break-words text-primary">最近产物：{latestArtifact.title} · {latestArtifact.status}</p> : null}
            {research?.executor?.connected === false ? <p className="text-muted-foreground">执行器未连接；此处仅显示已保存的计划和记录。</p> : null}
          </> : null}
        </div>
      </details>
    </div>
  )
}

function Metric({ icon: Icon, label, value, source, delta }: { icon: typeof Activity; label: string; value: string; source: string; delta?: string }) {
  return <div className="min-w-0 border-b border-border/60 py-2 last:border-0">
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-3 w-3" /></span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
      {delta ? <span className="shrink-0 text-[10px] text-emerald-700">{delta}</span> : null}
    </div>
    <p className="mt-1 truncate pl-7 text-[10px] text-muted-foreground">来源：{source}</p>
  </div>
}

export function MyOsOverview() {
  const { setActiveModule } = useAppStore()
  const profileQuery = useProfile()
  const grantedWorkspaces = useGrantedWorkspaces()
  const baseCurrency = useAppStore(state => state.baseCurrency)
  const dashboardQuery = useDashboard()
  const tasksQuery = useTasks()
  const eventsQuery = useEvents({ limit: 500 })
  const projectsQuery = useProjects()
  const recurringQuery = useRecurringTaskSeries()
  const updateTask = useUpdateTask()
  const updateEvent = useUpdateEvent()
  const createEvent = useCreateEvent()
  const [reminderTitle, setReminderTitle] = useState('')
  const dashboard = asRecord(dashboardQuery.data)
  const taskStats = asRecord(dashboard.tasks)
  const habitStats = asRecord(dashboard.habits)
  const financeStats = asRecord(dashboard.finance)
  const workspaceById = useMemo(() => new Map(grantedWorkspaces.workspaces.map(workspace => [workspace.workspaceId, workspace])), [grantedWorkspaces.workspaces])
  const tasks = (tasksQuery.data || []) as TaskRecord[]
  const projects = useMemo(() => new Map((projectsQuery.data || []).map(item => {
    const project = item as { id?: string; name?: string }
    return [String(project.id || ''), String(project.name || '')]
  })), [projectsQuery.data])
  const reminders = useMemo(() => {
    const response = eventsQuery.data as { events?: unknown[] } | undefined
    return asList(response?.events).filter(event => event.eventType === 'reminder') as unknown as ReminderRecord[]
  }, [eventsQuery.data])
  const recurring = recurringQuery.data?.series?.filter(series => !series.archived) || []
  const todayStart = startOfDay(new Date())
  const todayEnd = new Date(todayStart.getTime() + 86_400_000)
  const pendingReminders = reminders.filter(reminder => !reminder.completed && new Date(reminder.startDate) < todayEnd)
  const dueTasks = tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled'
    && ((task.dueDate && isBefore(new Date(task.dueDate), todayEnd)) || ['urgent', 'high'].includes(task.priority || '')))
  const attentionItems = [
    ...pendingReminders.map(reminder => ({ id: `reminder-${reminder.id}`, title: reminder.title, detail: taskDate(reminder.startDate), kind: 'reminder' as const, idValue: reminder.id })),
    ...dueTasks.map(task => ({ id: `task-${task.id}`, title: task.title, detail: `${projects.get(String(task.projectId || '')) || '个人任务'} · ${taskDate(task.dueDate)}`, kind: 'task' as const, idValue: task.id })),
  ].sort((a, b) => {
    const aDate = a.kind === 'reminder' ? reminders.find(row => row.id === a.idValue)?.startDate : tasks.find(row => row.id === a.idValue)?.dueDate
    const bDate = b.kind === 'reminder' ? reminders.find(row => row.id === b.idValue)?.startDate : tasks.find(row => row.id === b.idValue)?.dueDate
    return new Date(aDate || 0).getTime() - new Date(bDate || 0).getTime()
  })
  const attention = attentionItems.slice(0, 5)
  const oneTimeTasks = tasks.filter(task => task.status !== 'done' && task.status !== 'cancelled' && (!task.recurrence || task.recurrence === 'none'))
    .sort((a, b) => new Date(a.dueDate || '9999-12-31').getTime() - new Date(b.dueDate || '9999-12-31').getTime()).slice(0, 3)
  const personalMetrics = (() => {
    const items: { icon: typeof Activity; label: string; value: string; source: string }[] = []
    const habitTotal = Number(habitStats.total || 0)
    if (habitTotal > 0) items.push({ icon: Target, label: '今日习惯完成率', value: `${Number(habitStats.completionRate || 0)}%`, source: 'myOS · 习惯记录' })
    const accounts = asList(financeStats.accounts)
    if (accounts.length > 0) {
      const balance = Number(financeStats.totalBalance || 0)
      const currencies = [...new Set(accounts.map(account => String(account.currency || baseCurrency)))]
      const singleCurrency = currencies.length === 1 ? currencies[0] : null
      items.push({ icon: CircleDollarSign, label: singleCurrency ? '账户余额' : '财务账户', value: singleCurrency
        ? new Intl.NumberFormat(undefined, { style: 'currency', currency: singleCurrency, maximumFractionDigits: 0 }).format(balance)
        : `${accounts.length} 个账户`, source: singleCurrency ? `myOS · ${singleCurrency} 账户` : `myOS · ${currencies.length} 种币种，分别查看` })
    }
    const taskTotal = Number(taskStats.total || tasks.length)
    if (taskTotal > 0) items.push({ icon: ListChecks, label: '未完成任务', value: String(tasks.filter(task => !['done', 'cancelled'].includes(task.status)).length), source: `myOS · ${taskTotal} 条任务记录` })
    return items
  })()
  const businessMetrics = asList(dashboard.externalMetrics).flatMap(record => {
    const workspace = workspaceById.get(String(record.workspaceId || ''))
    if (!workspace || record.value === undefined || record.value === null) return []
    return [{
      icon: Activity,
      label: String(record.label || '工作台指标'),
      value: String(record.value),
      source: `${workspace.displayName}${record.source ? ` · ${String(record.source)}` : ''}`,
      delta: typeof record.delta === 'string' ? record.delta : undefined,
    }]
  })
  const metrics = [...personalMetrics, ...businessMetrics]
  const loading = dashboardQuery.isLoading || tasksQuery.isLoading || eventsQuery.isLoading || projectsQuery.isLoading || recurringQuery.isLoading
  const greetingName = typeof profileQuery.data?.name === 'string' ? profileQuery.data.name.trim().split(/\s+/)[0] : ''
  const hour = new Date().getHours()
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const demoData = dashboard.fixture === 'test'
  const submitQuickReminder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = reminderTitle.trim()
    if (!title || createEvent.isPending) return
    createEvent.mutate({ title, eventType: 'reminder', startDate: new Date().toISOString(), completed: false }, {
      onSuccess: () => setReminderTitle(''),
    })
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-3 px-3 pb-5 pt-3 sm:space-y-4 sm:px-5 sm:py-5 lg:px-7">
      <div className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
        <div>
          <div className="flex items-center gap-2"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">myOS · Work & Life, in one</p>{demoData ? <span className="rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">测试数据</span> : null}</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{greeting}{greetingName ? `，${greetingName}` : ''}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">今天要紧的事，都在这里。</p>
        </div>
        <p className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">{format(new Date(), 'EEEE · MMM d')}</p>
      </div>

      <div className="-mx-3 flex max-w-full gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
        <div aria-label={`${loading ? '—' : attentionItems.length} 件待处理`} className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border bg-card px-2.5 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-primary" /><span className="font-semibold tabular-nums text-foreground">{loading ? '—' : attentionItems.length}</span><span><span className="sm:hidden">待处理</span><span className="hidden sm:inline">件待处理</span></span></div>
        <div aria-label={`${recurringQuery.isLoading ? '—' : recurring.length} 个动态任务`} className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border bg-card px-2.5 text-xs text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 text-primary" /><span className="font-semibold tabular-nums text-foreground">{recurringQuery.isLoading ? '—' : recurring.length}</span><span><span className="sm:hidden">运行中</span><span className="hidden sm:inline">个动态任务</span></span></div>
        <div aria-label={`${loading ? '—' : metrics.length} 项关注指标`} className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border bg-card px-2.5 text-xs text-muted-foreground"><Activity className="h-3.5 w-3.5 text-primary" /><span className="font-semibold tabular-nums text-foreground">{loading ? '—' : metrics.length}</span><span><span className="sm:hidden">指标</span><span className="hidden sm:inline">项关注指标</span></span></div>
      </div>

      {tasksQuery.isError || eventsQuery.isError || dashboardQuery.isError ? <Card><CardContent className="p-4 text-sm text-muted-foreground" role="status">部分个人数据暂时无法读取；页面不会用示例数字替代。</CardContent></Card> : null}

      <div className="grid items-start gap-3.5 xl:grid-cols-[1.02fr_1.15fr_0.98fr]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
            <div><CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" />需要我处理</CardTitle><CardDescription className="mt-1">提醒与有截止日期的任务</CardDescription></div>
            <Button variant="ghost" className="min-h-11 shrink-0 px-2 text-xs" onClick={() => setActiveModule('reminders')}>提醒 <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="py-5 text-center text-sm text-muted-foreground">正在读取个人数据…</p>
              : attention.length ? attention.map(item => <div key={item.id} className="flex min-w-0 items-center gap-2 border-b pb-2 last:border-0 last:pb-0">
                <button type="button" aria-label={`${item.kind === 'reminder' ? '完成提醒' : '完成任务'}：${item.title}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:border-primary hover:text-primary" onClick={() => {
                  if (item.kind === 'reminder') updateEvent.mutate({ id: item.idValue, completed: true })
                  else updateTask.mutate({ id: item.idValue, status: 'done' })
                }}><Check className="h-4 w-4" /></button>
                <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{item.detail}</p></div>
                <Badge variant={item.kind === 'reminder' ? 'secondary' : 'outline'} className="shrink-0">{item.kind === 'reminder' ? '提醒' : '任务'}</Badge>
              </div>)
                : <div className="rounded-lg border border-dashed p-4 text-center"><Check className="mx-auto h-4 w-4 text-primary" /><p className="mt-2 text-sm font-medium">目前没有到期事项</p><p className="mt-1 text-xs text-muted-foreground">新建提醒或设置任务截止时间后会出现在这里。</p></div>}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
            <div><CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4 text-violet-600" />动态任务</CardTitle><CardDescription className="mt-1">区分一次性与持续任务，显示已保存计划、执行记录和产物</CardDescription></div>
            <Button variant="ghost" className="min-h-11 shrink-0 px-2 text-xs" onClick={() => setActiveModule('tasks')}>任务中心 <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">持续任务</h3><span className="text-xs text-muted-foreground">{recurringQuery.data?.schedulerEnabled ? '自动调度已配置' : '自动调度未启用'}</span></div>
              {recurringQuery.isError ? <p role="status" className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">持续任务状态暂不可用。</p>
                : recurring.length ? <div className="space-y-2">{recurring.slice(0, 3).map(series => {
                  const task = tasks.find(candidate => candidate.id === series.currentTaskId)
                  const projectName = task?.project?.name || projects.get(String(task?.projectId || '')) || null
                  return <div key={series.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{series.title}</p><p className="mt-1 text-xs text-muted-foreground">{projectName ? `项目：${projectName}` : '未关联项目'} · {series.recurrence === 'daily' ? '每日' : series.recurrence === 'weekly' ? '每周' : '每月'}</p></div><Badge variant="secondary" className="shrink-0">持续</Badge></div>
                    {task ? <DynamicTaskDetail task={task} projectName={projectName} /> : <p className="mt-3 text-xs text-muted-foreground">当前任务详情暂不可用。</p>}
                  </div>
                })}</div>
                  : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">暂无持续任务。已有的重复任务会在这里展示。</p>}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">一次性任务</h3><span className="text-xs text-muted-foreground">{oneTimeTasks.length} 项显示</span></div>
              {oneTimeTasks.length ? <ul className="divide-y divide-border/60">{oneTimeTasks.map(task => <li key={task.id} className="flex min-w-0 items-start gap-2 py-2 first:pt-0 last:pb-0"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{task.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{task.project?.name || projects.get(String(task.projectId || '')) || '未关联项目'} · {taskDate(task.dueDate)}</p></div><Badge variant="outline" className="shrink-0">一次性</Badge></li>)}</ul>
                : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">暂无未完成的一次性任务。</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-amber-600" />关注指标</CardTitle><CardDescription className="mt-1">仅显示现有个人记录；业务来源未接入时保持空态。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {metrics.length ? <div className="-mx-4 flex max-w-full gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 sm:pb-0 xl:grid-cols-1">{metrics.map(metric => <div key={metric.label} className="min-w-[155px] sm:min-w-0"><Metric {...metric} /></div>)}</div>
              : <div className="rounded-lg border border-dashed p-4 text-center"><TriangleAlert className="mx-auto h-4 w-4 text-muted-foreground" /><p className="mt-2 text-sm font-medium">暂无可用指标</p><p className="mt-1 text-xs text-muted-foreground">记录习惯、任务或财务数据后，myOS 会显示真实汇总。</p></div>}
            {businessMetrics.length === 0 ? <div className="rounded-lg border border-dashed p-3">
              <p className="text-sm font-medium">业务工作台指标</p>
              <p className="mt-1 text-xs text-muted-foreground">没有可读取的已授权业务指标。工作台授权本身不会自动提供业务数据。</p>
            </div> : null}
            {financeStats.monthlyIncome != null || financeStats.monthlyExpenses != null ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><RotateCw className="h-3.5 w-3.5" />本月收支来自当前 myOS 财务记录。</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-2"><Sparkles className="h-4 w-4 shrink-0 text-primary" /><div className="min-w-0"><p className="text-sm font-medium">轻量提醒</p><p className="truncate text-xs text-muted-foreground">快速记下，稍后再整理</p></div></div>
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={submitQuickReminder}>
            <Input value={reminderTitle} onChange={event => setReminderTitle(event.target.value)} maxLength={240} aria-label="提醒内容" placeholder="写下提醒事项…" className="h-10 min-w-0 flex-1 text-sm" />
            <Button type="submit" variant="outline" disabled={!reminderTitle.trim() || createEvent.isPending} className="h-10 shrink-0 gap-1.5 px-3"><Plus className="h-4 w-4" />{createEvent.isPending ? '保存中…' : '添加提醒'}</Button>
          </form>
          {createEvent.isError ? <p role="alert" className="text-xs text-destructive">提醒未保存，请重试。</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
