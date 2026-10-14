import { describe, expect, it } from 'vitest'
import { buildGoalEditChanges, mapApiGoal } from '@/components/lifeos/goals/goals-page'
import type { Goal } from '@/stores/goal-store'

const original: Pick<Goal, 'id' | 'title' | 'description' | 'category' | 'targetDate'> = {
  id: 'goal-1',
  title: 'Read more',
  description: 'Keep the current plan',
  category: 'personal',
  targetDate: '2026-12-31',
}

describe('goal edit date and patch behavior', () => {
  it('keeps a timestamp-backed date as its calendar date', () => {
    expect(mapApiGoal({
      ...original,
      targetDate: '2026-12-31T19:25:00.000Z',
      status: 'not-started',
      progress: 0,
      milestones: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }).targetDate).toBe('2026-12-31')
  })

  it('sends only the edited title and leaves the saved target date untouched', () => {
    const changes = buildGoalEditChanges(original, { ...original, title: '  Read daily  ' })

    expect(changes).toEqual({ title: 'Read daily' })
    expect(changes).not.toHaveProperty('targetDate')
  })

  it('includes a target date only when the user changes or clears it', () => {
    expect(buildGoalEditChanges(original, { ...original, targetDate: '2027-01-01' })).toEqual({ targetDate: '2027-01-01' })
    expect(buildGoalEditChanges(original, { ...original, targetDate: null })).toEqual({ targetDate: null })
  })
})
