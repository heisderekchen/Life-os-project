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
