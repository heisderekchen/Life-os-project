import { describe, expect, it } from 'vitest'
import type { Task } from '@/stores/task-store'
import { compareWorkspaceTasks, resolveTaskOwnership, taskTree, withTaskAncestors } from '@/components/lifeos/projects/workspace-model'
const task = (id: string, changes: Partial<Task> = {}): Task => ({ id, title: id, description: '', status: 'todo', priority: 'medium', projectId: null, parentTaskId: null, dueDate: null, startDate: null, completedAt: null, estimatedMinutes: null, actualMinutes: null, recurrence: null, recurrenceConfig: null, tags: [], createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', ...changes })
describe('workspace relationships', () => {
  it('places descendants with their recorded parent without modifying API records', () => {
    const records = [task('root', { projectId: 'project', topicId: 'topic' }), task('child', { parentTaskId: 'root' }), task('grandchild', { parentTaskId: 'child' })]
    const display = resolveTaskOwnership(records)
    expect(display.map(item => [item.projectId, item.topicId])).toEqual([['project','topic'],['project','topic'],['project','topic']])
    expect(records[1].projectId).toBeNull()
    const tree = taskTree(display)
    expect(tree).toHaveLength(1)
    expect(tree[0].children[0].children[0].task.id).toBe('grandchild')
  })
  it('preserves explicit alternative ownership and does not carry a topic across projects', () => {
    const records = [task('root', { projectId: 'a', topicId: 'topic-a' }), task('child', { parentTaskId: 'root', projectId: 'b' }), task('other', { parentTaskId: 'root', topicId: 'topic-b' })]
    const display = resolveTaskOwnership(records)
    expect(display[1]).toMatchObject({ projectId: 'b', topicId: null, parentTaskId: 'root' })
    expect(display[2]).toMatchObject({ projectId: 'a', topicId: 'topic-b' })
    expect(taskTree(display)).toHaveLength(3)
  })
  it('retains parent context for filtered children and keeps orphaned/cyclic records reachable', () => {
    const records = [task('parent'), task('child', { parentTaskId: 'parent' }), task('orphan', { parentTaskId: 'missing' }), task('x', { parentTaskId: 'y' }), task('y', { parentTaskId: 'x' })]
    const filtered = withTaskAncestors([records[1]], records)
    expect(taskTree(filtered)[0].task.id).toBe('parent')
    expect(taskTree(filtered)[0].children[0].task.id).toBe('child')
    expect(taskTree(resolveTaskOwnership(records)).map(node => node.task.id)).toEqual(['parent','orphan','x','y'])
  })
})
describe('workspace column sorting', () => {
  it('sorts all visible columns in either direction with empty values last', () => {
    const records = [task('b', { title: 'Beta', taskType: 'Bug', status: 'done', dueDate: '2030-01-02', updatedAt: '2026-10-19T02:00:00Z' }), task('a', { title: 'Alpha', taskType: 'Analysis', status: 'todo', dueDate: '2030-01-01', updatedAt: '2026-10-19T01:00:00Z' })]
    for (const sort of ['name','type','status','due','updated'] as const) {
      expect([...records].sort((a,b) => compareWorkspaceTasks(a,b,sort,true,'en')).map(task => task.id)).toEqual(['a','b'])
      expect([...records].sort((a,b) => compareWorkspaceTasks(a,b,sort,false,'en')).map(task => task.id)).toEqual(['b','a'])
    }
    for (const ascending of [true,false]) for (const sort of ['due','type'] as const) {
      const sorted = [...records, task('empty')].sort((a,b) => compareWorkspaceTasks(a,b,sort,ascending))
      expect(sorted.at(-1)?.id).toBe('empty')
    }
  })
})
