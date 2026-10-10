import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TaskRunSignals } from '@/components/lifeos/tasks/tasks-page'
import { useAppStore } from '@/stores/app-store'
import type { Task } from '@/stores/task-store'

const baseTask = {
  id: 'synthetic-task',
  title: 'Local layout fixture',
  description: 'Preview-only target.\n\n[停点]\nSynthetic progress line for the UI preview.',
  status: 'in-progress',
  priority: 'medium',
  dueDate: null,
  startDate: null,
  completedAt: null,
  estimatedMinutes: null,
  actualMinutes: null,
  projectId: null,
  parentTaskId: null,
  recurrence: null,
  recurrenceConfig: null,
  tags: [],
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
} satisfies Task

describe('TaskRunSignals', () => {
  beforeEach(() => useAppStore.setState({ language: 'zh' }))
  afterEach(() => cleanup())

  it('shows only task-backed progress and truthful unconfigured execution fields', () => {
    render(<TaskRunSignals task={baseTask} />)

    expect(screen.getByText('Synthetic progress line for the UI preview.')).toBeInTheDocument()
    expect(screen.getByText('执行器未配置')).toBeInTheDocument()
    expect(screen.getByText('验收流程未配置')).toBeInTheDocument()
    expect(screen.getByText('暂无执行记录')).toBeInTheDocument()
  })

  it('does not invent progress when the task has no handoff entry', () => {
    render(<TaskRunSignals task={{ ...baseTask, description: 'Task goal only.' }} />)

    expect(screen.getByText('还没有记录最新进度。')).toBeInTheDocument()
    expect(screen.queryByText(/running|在线/i)).not.toBeInTheDocument()
  })
})
