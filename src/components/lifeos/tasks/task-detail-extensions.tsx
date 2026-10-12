'use client'

import { TaskCardPanel } from './task-card-panel'
import { ResearchPanel } from './research-panel'
import { ChevronDown, Layers3 } from 'lucide-react'

// Keep planning/research/knowledge capabilities available without crowding the
// task's primary goal and next action.
export function TaskDetailExtensions({ taskId }: { taskId: string }) {
  return <details data-testid="task-detail-extensions" className="group rounded-xl border border-border/60 bg-card">
    <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><Layers3 className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">子任务、编排与研究</span><span className="mt-0.5 block text-xs text-muted-foreground">任务卡片、持续研究与关联材料</span></span>
      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-border/60 p-4">
      <TaskCardPanel taskId={taskId} />
      <ResearchPanel taskId={taskId} />
    </div>
  </details>
}
