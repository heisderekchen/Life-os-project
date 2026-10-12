export type TaskMetricInput = { status?: string }

export function getTaskMetrics(tasks: TaskMetricInput[]) {
  const completed = tasks.filter(task => task.status === 'done').length
  return {
    total: tasks.length,
    completed,
    remaining: tasks.length - completed,
    completionPercent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  }
}
