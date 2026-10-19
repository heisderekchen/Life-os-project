import type { Project, Task } from '@/stores/task-store'

export interface WorkspaceProject extends Project { archived?: boolean }
export interface ProjectTopic { id: string; projectId: string; name: string; createdAt: string; updatedAt: string }
export interface WorkspaceGroup { id: string; name: string; project: WorkspaceProject | null; topics: { id: string; name: string; topic: ProjectTopic | null; tasks: Task[] }[]; tasks: Task[] }
export const INBOX = '__inbox__'
export const UNCLASSIFIED = '__unclassified__'
export type WorkspaceSelection = { kind: 'project' | 'topic' | 'task'; id: string } | null
export const projectKey = (task: Task) => task.projectId || INBOX
export const topicKey = (task: Task) => `${projectKey(task)}:${task.topicId || UNCLASSIFIED}`
export const taskType = (task: Task) => task.taskType || task.sourceType || ''
export const nodeKey = (selection: NonNullable<WorkspaceSelection>) => `${selection.kind}:${selection.id}`

export function taskAncestors(task: Task, tasks: Task[]): Task[] {
  const byId = new Map(tasks.map(item => [item.id, item]))
  const seen = new Set([task.id]), ancestors: Task[] = []
  let parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined
  while (parent && !seen.has(parent.id)) {
    ancestors.push(parent); seen.add(parent.id)
    parent = parent.parentTaskId ? byId.get(parent.parentTaskId) : undefined
  }
  return ancestors
}

// Display inheritance follows recorded parent links. Never write inferred values
// back to the task: the inspector still edits the original API record.
export function resolveTaskOwnership(tasks: Task[]): Task[] {
  return tasks.map(task => {
    let projectId: string | null = null, topicId: string | null = null
    for (const item of [...taskAncestors(task, tasks).reverse(), task]) {
      if (item.projectId && item.projectId !== projectId) topicId = null
      projectId = item.projectId || projectId
      topicId = item.topicId || topicId
    }
    return { ...task, projectId, topicId }
  })
}

export interface TaskBranch { task: Task; children: TaskBranch[] }
export function taskTree(tasks: Task[]): TaskBranch[] {
  const nodes = new Map(tasks.map(task => [task.id, { task, children: [] } as TaskBranch]))
  const roots: TaskBranch[] = []
  for (const node of nodes.values()) {
    const parent = node.task.parentTaskId ? nodes.get(node.task.parentTaskId) : undefined
    if (parent && parent !== node && topicKey(parent.task) === topicKey(node.task)
      && !taskAncestors(parent.task, tasks).some(task => task.id === node.task.id)) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function withTaskAncestors(matches: Task[], tasks: Task[]): Task[] {
  const included = new Set(matches.map(task => task.id))
  for (const task of matches) for (const parent of taskAncestors(task, tasks)) {
    if (topicKey(parent) === topicKey(task)) included.add(parent.id)
  }
  return [...matches, ...tasks.filter(task => included.has(task.id) && !matches.some(match => match.id === task.id))]
}

export type WorkspaceSort = 'updated' | 'name' | 'type' | 'status' | 'due'
export function compareWorkspaceTasks(a: Task, b: Task, sort: WorkspaceSort, ascending: boolean, locale = 'zh-CN') {
  const values = (task: Task): string | number | null => {
    if (sort === 'name') return task.title
    if (sort === 'type') return taskType(task) || null
    if (sort === 'status') return { todo: 0, 'in-progress': 1, done: 2, cancelled: 3 }[task.status]
    const value = sort === 'due' ? task.dueDate : task.updatedAt
    return value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : null
  }
  const av = values(a), bv = values(b)
  if (av == null || bv == null) return av == null ? (bv == null ? a.id.localeCompare(b.id) : 1) : -1
  const compared = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), locale)
  return (ascending ? compared : -compared) || a.id.localeCompare(b.id)
}

export function workspaceGroups(projects: WorkspaceProject[], topics: ProjectTopic[], tasks: Task[], inboxName: string, unclassifiedName: string): WorkspaceGroup[] {
  const result: WorkspaceGroup[] = projects.map(project => ({ id: project.id, name: project.name, project, tasks: tasks.filter(task => task.projectId === project.id), topics: [] }))
  const known = new Set(projects.map(project => project.id))
  const inboxTasks = tasks.filter(task => !task.projectId || !known.has(task.projectId))
  if (inboxTasks.length) result.push({ id: INBOX, name: inboxName, project: null, topics: [], tasks: inboxTasks })
  for (const group of result) {
    const owned = topics.filter(topic => topic.projectId === group.id)
    group.topics = owned.map(topic => ({ id: `${group.id}:${topic.id}`, name: topic.name, topic, tasks: group.tasks.filter(task => task.topicId === topic.id) }))
    const topicIds = new Set(owned.map(topic => topic.id))
    const unclassified = group.tasks.filter(task => !task.topicId || !topicIds.has(task.topicId))
    if (unclassified.length || !group.topics.length) group.topics.push({ id: `${group.id}:${UNCLASSIFIED}`, name: unclassifiedName, topic: null, tasks: unclassified })
  }
  return result
}

export function selectedScope(selection: WorkspaceSelection, groups: WorkspaceGroup[], tasks: Task[]): { projectId: string; topicId?: string } | null {
  if (!selection) return null
  if (selection.kind === 'project') return { projectId: selection.id }
  if (selection.kind === 'topic') {
    const group = groups.find(group => group.topics.some(topic => topic.id === selection.id))
    return group ? { projectId: group.id, topicId: selection.id } : null
  }
  const task = tasks.find(task => task.id === selection.id)
  if (!task) return null
  const group = groups.find(group => group.tasks.some(item => item.id === task.id))
  const topic = group?.topics.find(topic => topic.tasks.some(item => item.id === task.id))
  return group ? { projectId: group.id, topicId: topic?.id } : null
}
