'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { Bell, Check, Clock3, Plus, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useCreateEvent, useEvents, useUpdateEvent } from '@/lib/api/hooks'
import { showToast } from '@/lib/toast'

type Reminder = {
  id: string
  title: string
  description?: string | null
  startDate: string
  completed: boolean
  eventType: 'event' | 'reminder'
  taskId?: string | null
}

function toLocalDateTimeInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function displayDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未设置' : format(date, 'MMM d · HH:mm')
}

export function RemindersPage() {
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(() => toLocalDateTimeInput(new Date()))
  const eventsQuery = useEvents({ limit: 500 })
  const createReminder = useCreateEvent()
  const updateReminder = useUpdateEvent()

  const reminders = useMemo(() => {
    const response = eventsQuery.data as { events?: unknown[] } | undefined
    return (response?.events || [])
      .filter((row): row is Reminder => !!row && typeof row === 'object'
        && (row as Reminder).eventType === 'reminder')
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
  }, [eventsQuery.data])
  const open = reminders.filter(reminder => !reminder.completed)
  const completed = reminders.filter(reminder => reminder.completed)

  const addReminder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle || createReminder.isPending) return
    try {
      await createReminder.mutateAsync({
        title: cleanTitle,
        eventType: 'reminder',
        completed: false,
        startDate: new Date(startDate).toISOString(),
        allDay: false,
      })
      setTitle('')
      showToast.success('提醒已添加')
    } catch {
      showToast.error('提醒没有保存成功，请重试')
    }
  }

  const toggleCompleted = async (reminder: Reminder) => {
    if (updateReminder.isPending) return
    try {
      await updateReminder.mutateAsync({ id: reminder.id, completed: !reminder.completed })
    } catch {
      showToast.error('提醒状态没有更新，请重试')
    }
  }

  const renderList = (items: Reminder[], done = false) => (
    <ul className="divide-y divide-border/70">
      {items.map(reminder => (
        <li key={reminder.id} className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
          <button
            type="button"
            aria-label={done ? `重新打开提醒：${reminder.title}` : `完成提醒：${reminder.title}`}
            aria-pressed={done}
            disabled={updateReminder.isPending}
            onClick={() => void toggleCompleted(reminder)}
            className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
          >
            {done ? <Check className="h-4 w-4" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
          </button>
          <div className="min-w-0 flex-1 pt-1">
            <p className={done ? 'break-words text-sm text-muted-foreground line-through' : 'break-words text-sm font-medium'}>{reminder.title}</p>
            {reminder.description ? <p className="mt-1 break-words text-xs text-muted-foreground">{reminder.description}</p> : null}
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />{displayDate(reminder.startDate)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-6 sm:pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">myOS · Reminder</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">提醒</h1>
          <p className="mt-1 text-sm text-muted-foreground">先记下要做的事；提醒独立于项目任务。</p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{open.length} 项未完成</span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" />快速添加提醒</CardTitle>
          <CardDescription>不会创建项目任务，也不会触发自动执行。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addReminder} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
            <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={500} placeholder="例如：下午回访两家门店" aria-label="提醒内容" className="min-h-11" />
            <Input type="datetime-local" value={startDate} onChange={event => setStartDate(event.target.value)} aria-label="提醒时间" className="min-h-11" />
            <Button type="submit" disabled={!title.trim() || createReminder.isPending} className="min-h-11 gap-2"><Plus className="h-4 w-4" />添加</Button>
          </form>
        </CardContent>
      </Card>

      {eventsQuery.isError ? (
        <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p role="alert" className="text-sm text-muted-foreground">提醒暂时无法读取，已保存的数据没有被修改。</p>
          <Button variant="outline" className="min-h-11 gap-2" onClick={() => void eventsQuery.refetch()}><RotateCcw className="h-4 w-4" />重试</Button>
        </CardContent></Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">未完成</CardTitle><CardDescription>按提醒时间排列</CardDescription></CardHeader>
        <CardContent>
          {eventsQuery.isLoading ? <p className="text-sm text-muted-foreground">正在读取提醒…</p>
            : open.length ? renderList(open)
              : <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">目前没有待处理提醒。</p>}
        </CardContent>
      </Card>

      {completed.length ? <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">已完成</CardTitle></CardHeader>
        <CardContent>{renderList(completed, true)}</CardContent>
      </Card> : null}
    </div>
  )
}
