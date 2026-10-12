'use client'

import { TaskCardPanel } from './task-card-panel'
import { ResearchPanel } from './research-panel'

// Keep the task planning and research tools in one reusable point that the
// selected-task desktop panel and mobile sheet can share.
export function TaskDetailExtensions({ taskId }: { taskId: string }) {
  return <div data-testid="task-detail-extensions" className="space-y-5">
    <TaskCardPanel taskId={taskId} />
    <ResearchPanel taskId={taskId} />
  </div>
}
