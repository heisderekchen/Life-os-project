import { describe, expect, it } from 'vitest'
import { getTaskMetrics } from '@/lib/task-metrics'

describe('dashboard task metrics', () => {
  it('uses the same three tasks shown in the dashboard queue', () => {
    const tasks = [{ status: 'in-progress' }, { status: 'todo' }, { status: 'done' }]
    expect(getTaskMetrics(tasks)).toEqual({ total: 3, completed: 1, remaining: 2, completionPercent: 33 })
  })

  it('handles empty and all-complete lists', () => {
    expect(getTaskMetrics([])).toEqual({ total: 0, completed: 0, remaining: 0, completionPercent: 0 })
    expect(getTaskMetrics([{ status: 'done' }])).toEqual({ total: 1, completed: 1, remaining: 0, completionPercent: 100 })
  })
})
