'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CircleAlert, Play, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Task = Record<string, unknown>

const HANDOFF_MARKER = '[停点]'

function readHandoff(task?: Task) {
  const description = String(task?.description || '')
  const markerIndex = description.lastIndexOf(HANDOFF_MARKER)
  return markerIndex === -1 ? '' : description.slice(markerIndex + HANDOFF_MARKER.length).trim()
}

export function ContinuityPanel({
  tasks,
  onOpenTasks,
  onSaveHandoff,
  isSaving,
}: {
  tasks: Task[]
  onOpenTasks: () => void
  onSaveHandoff: (task: Task, handoff: string) => void
  isSaving?: boolean
}) {
  const [handoff, setHandoff] = useState('')
  const focus = useMemo(() => {
    const active = tasks.filter(task => task.status !== 'done')
    return active.find(task => readHandoff(task)) || active.find(task => task.status === 'in-progress') || active[0]
  }, [tasks])
  const blocked = useMemo(() => tasks.filter(task => String(task.description || '').toLowerCase().includes('#blocker')), [tasks])
  const existingHandoff = readHandoff(focus)

  useEffect(() => {
    setHandoff(existingHandoff)
  }, [focus?.id, existingHandoff])

  const saveHandoff = () => {
    if (!focus || !handoff.trim() || isSaving) return
    onSaveHandoff(focus, handoff.trim())
  }

  return <Card className="rounded-xl shadow-sm border-primary/15">
    <CardHeader className="pb-2 px-5 pt-5">
      <CardTitle className="text-sm font-semibold flex items-center gap-2"><Play className="h-4 w-4 text-primary" />从上次停下的地方继续</CardTitle>
    </CardHeader>
    <CardContent className="px-5 pb-5 space-y-4">
      <div className="rounded-lg bg-primary/8 px-3.5 py-3">
        <p className="text-[11px] text-muted-foreground mb-1">现在最值得推进的一件事</p>
        <p className="text-sm font-semibold">{String(focus?.title || '先收集一件想推进的事')}</p>
        {existingHandoff && <p className="mt-1.5 text-xs leading-5 text-muted-foreground line-clamp-2">上次停在：{existingHandoff}</p>}
        <button onClick={onOpenTasks} className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1 hover:underline">打开项目 <ArrowRight className="h-3 w-3" /></button>
      </div>
      {blocked.length > 0 && <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-300"><CircleAlert className="h-4 w-4 shrink-0" /><span>{blocked.length} 个项目有阻塞；把它写清楚，下一次不用重新回忆。</span></div>}
      {focus ? <div className="space-y-2">
        <label className="text-xs text-muted-foreground">离开前留一个停点</label>
        <Textarea value={handoff} onChange={event => setHandoff(event.target.value)} placeholder="做到哪里了？下一步具体做什么？" className="min-h-20 resize-none text-sm" />
        <Button size="sm" className="w-full" onClick={saveHandoff} disabled={!handoff.trim() || isSaving}>
          <Save className="h-3.5 w-3.5 mr-1.5" />{isSaving ? '正在保存…' : '保存到任务，换设备也能继续'}
        </Button>
      </div> : <p className="text-xs leading-5 text-muted-foreground">先用左侧的快速添加建立第一个任务；之后每次离开前都可以在这里留下下一步。</p>}
    </CardContent>
  </Card>
}
