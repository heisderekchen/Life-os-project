const RECURRENCES = new Set(['daily', 'weekly', 'monthly'])
const ACTIVE_STATUSES = new Set(['todo', 'in-progress'])

function newestFirst(a, b) {
  return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
}

/**
 * Collapse generated recurrence instances into their original task series.
 * The ledger is the source of lineage; task titles and dates are never used
 * to guess whether two tasks belong together.
 */
export function buildRecurringTaskSeries(taskRows, runRows) {
  const tasks = new Map(taskRows.map(task => [String(task.id), task]))
  const childrenBySource = new Map()
  const generatedIds = new Set()

  for (const run of runRows) {
    const sourceId = String(run.source_task_id)
    const generatedId = String(run.generated_task_id)
    if (!tasks.has(sourceId) || !tasks.has(generatedId)) continue
    const children = childrenBySource.get(sourceId) || []
    children.push(generatedId)
    childrenBySource.set(sourceId, children)
    generatedIds.add(generatedId)
  }

  const roots = [...tasks.values()].filter(task => RECURRENCES.has(task.recurrence) && !generatedIds.has(String(task.id)))
  const series = []
  for (const root of roots) {
    const visited = new Set()
    const pending = [String(root.id)]
    const leaves = []
    while (pending.length) {
      const id = pending.pop()
      if (visited.has(id)) continue
      visited.add(id)
      const children = (childrenBySource.get(id) || []).filter(childId => !visited.has(childId))
      if (children.length) pending.push(...children)
      else if (tasks.has(id)) leaves.push(tasks.get(id))
    }
    const visibleLeaves = leaves.filter(task => !Boolean(task.archived))
    const candidates = visibleLeaves.length ? visibleLeaves : leaves
    candidates.sort(newestFirst)
    const current = candidates[0]
    if (!current) continue
    series.push({
      id: String(root.id),
      currentTaskId: String(current.id),
      title: String(current.title || root.title || ''),
      status: String(current.status || 'todo'),
      recurrence: root.recurrence,
      dueDate: current.due_date || null,
      updatedAt: current.updated_at || current.created_at || null,
      archived: Boolean(current.archived),
    })
  }

  series.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return {
    series,
    activeCount: series.filter(item => !item.archived && ACTIVE_STATUSES.has(item.status)).length,
  }
}
