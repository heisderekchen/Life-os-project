'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, ExternalLink, FileText, Folder, Inbox, Layers, List, LoaderCircle, Network, PanelLeftClose, Plus, Search, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTasks, useProjects, useCreateTask, useCreateProject, useUpdateTask, useUpdateProject } from '@/lib/api/hooks'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api/client'
import { useTranslation } from '@/lib/i18n'
import { useTaskStore, type Task } from '@/stores/task-store'
import { TasksPage, mapApiTask, mapApiProject } from '../tasks/tasks-page'
import { ProjectsPage } from './projects-page'
import { WorkspaceGraph } from './workspace-graph'
import { WorkspaceContextMenu, WorkspaceActionsButton, type WorkspaceMenu } from './workspace-actions'
import { INBOX, UNCLASSIFIED, compareWorkspaceTasks, resolveTaskOwnership, selectedScope, taskAncestors, taskTree, taskType, withTaskAncestors, workspaceGroups, type WorkspaceSort, type ProjectTopic, type WorkspaceProject, type WorkspaceSelection } from './workspace-model'
import { WorkspaceResizeHandle, useWorkspaceLayout } from './workspace-resize'
import { TaskNotes } from './task-notes'
import './project-workspace.css'

type View = 'linked' | 'list' | 'graph'
type Status = 'all' | 'todo' | 'in-progress' | 'overdue' | 'done' | 'cancelled'
type Preferences = { view: View; search: string; status: Status; type: string; project: string; sort: WorkspaceSort; ascending: boolean; grouped: boolean; archived: boolean }
const defaults: Preferences = { view: 'linked', search: '', status: 'all', type: '', project: '', sort: 'updated', ascending: false, grouped: true, archived: false }
const preferenceKey = 'myos-project-workspace-v1'
const statuses = ['all', 'todo', 'in-progress', 'overdue', 'done', 'cancelled'] as const
const statusNames = { zh: { all: '全部', todo: '待办', 'in-progress': '进行中', overdue: '已逾期', done: '已完成', cancelled: '已取消' }, en: { all: 'All', todo: 'To do', 'in-progress': 'In progress', overdue: 'Overdue', done: 'Completed', cancelled: 'Cancelled' } }
const overdue = (task: Task) => Boolean(task.dueDate && !['done', 'cancelled'].includes(task.status) && task.dueDate.slice(0, 10) < new Date().toLocaleDateString('en-CA'))
const dateLabel = (value: string | null | undefined, zh: boolean) => {
  if (!value || Number.isNaN(Date.parse(value))) return '—'
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}
const dateInput = (value: string | null) => value?.slice(0, 10) || ''

function TaskInspector({ task, effectiveTask = task, parent, onParent, projects, topics, zh, onFull }: { task: Task; effectiveTask?: Task; parent?: Task; onParent?: () => void; projects: WorkspaceProject[]; topics: ProjectTopic[]; zh: boolean; onFull: () => void }) {
  const mutation = useUpdateTask()
  const [draft, setDraft] = useState({ projectId: task.projectId || '', topicId: task.topicId || '', status: task.status, taskType: taskType(task), dueDate: dateInput(task.dueDate) })
  const [error, setError] = useState('')
  const changed = draft.projectId !== (task.projectId || '') || draft.topicId !== (task.topicId || '') || draft.status !== task.status || draft.taskType !== taskType(task) || draft.dueDate !== dateInput(task.dueDate)
  const topic = topics.find(topic => topic.id === effectiveTask.topicId)
  const project = projects.find(project => project.id === effectiveTask.projectId)
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      await mutation.mutateAsync({ id: task.id, ...draft, projectId: draft.projectId || null, topicId: draft.topicId || null, taskType: draft.taskType.trim() || null, dueDate: draft.dueDate || null })
      toast.success(zh ? '任务已保存' : 'Task saved')
    } catch (error) { setError(error instanceof Error ? error.message : (zh ? '保存失败，请重试' : 'Could not save. Please retry.')) }
  }
  return <section className="workspace-inspector" aria-label={zh ? '任务概要' : 'Task summary'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-lg font-semibold">{task.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{project?.name || (zh ? '未分配项目' : 'Unassigned project')}<span aria-hidden> › </span>{topic?.name || (zh ? '未分类' : 'Unclassified')}</p></div><Button variant="ghost" size="sm" className="h-10" onClick={() => document.getElementById(`task-notes-text-${task.id}`)?.focus()}>{zh ? '写备注' : 'Add note'}</Button><Button variant="outline" size="sm" className="h-10 gap-2" onClick={onFull}>{zh ? '打开完整详情' : 'Full details'}<ExternalLink size={14} /></Button></div>
    {task.parentTaskId && <p className="workspace-parent-path">{zh ? '父任务：' : 'Parent task: '}{parent ? <button type="button" onClick={onParent}>{parent.title}</button> : (zh ? '已归档或不可见' : 'Archived or unavailable')}{!task.projectId && parent?.projectId && <span>{zh ? ' · 项目与未单独设置的主题沿用父任务展示' : ' · Unset ownership follows the parent in this view'}</span>}</p>}
    <form onSubmit={save} className="mt-5 space-y-4">
      <div className="workspace-fields">
        <label>{zh ? '所属项目' : 'Project'}<select value={draft.projectId} onChange={event => setDraft({ ...draft, projectId: event.target.value, topicId: '' })}><option value="">{parent?.projectId ? (zh ? `沿用父任务（${projects.find(project => project.id === parent.projectId)?.name || parent.projectId}）` : 'Follow parent project') : (zh ? '未分配项目' : 'Unassigned project')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? (zh ? '（已归档）' : ' (archived)') : ''}</option>)}</select></label>
        <label>{zh ? '所属主题' : 'Topic'}<select value={draft.topicId} onChange={event => setDraft({ ...draft, topicId: event.target.value })} disabled={!draft.projectId}><option value="">{parent?.topicId && (!draft.projectId || draft.projectId === parent.projectId) ? (zh ? '沿用父任务主题' : 'Follow parent topic') : (zh ? '未分类' : 'Unclassified')}</option>{topics.filter(topic => topic.projectId === draft.projectId).map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
        <label>{zh ? '状态' : 'Status'}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Task['status'] })}>{(['todo', 'in-progress', 'done', 'cancelled'] as const).map(status => <option key={status} value={status}>{statusNames[zh ? 'zh' : 'en'][status]}</option>)}</select></label>
        <label>{zh ? '类型' : 'Type'}<input value={draft.taskType} maxLength={60} placeholder={zh ? '例如：需求、缺陷、研究' : 'Requirement, bug, research…'} onChange={event => setDraft({ ...draft, taskType: event.target.value })} /></label>
        <label>{zh ? '截止日期' : 'Due date'}<input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })} /></label>
      </div>
      {task.description && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{task.description}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{zh ? '最近更新' : 'Updated'} {dateLabel(task.updatedAt, zh)}</span><Button type="submit" size="sm" disabled={!changed || mutation.isPending}>{mutation.isPending ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存修改' : 'Save changes')}</Button></div>
    </form>
  </section>
}

export function ProjectWorkspace() {
  const sidebarProject = useTaskStore(state => state.selectedProjectId)
  const { language } = useTranslation(), zh = language === 'zh'
  const say = (cn: string, en: string) => zh ? cn : en
  const labels = statusNames[zh ? 'zh' : 'en']
  const projectsQuery = useProjects(), tasksQuery = useTasks()
  const topicsQuery = useQuery({ queryKey: ['project-topics'], queryFn: () => apiGet<ProjectTopic[]>('/api/topics') })
  const qc = useQueryClient(), createTask = useCreateTask(), createProject = useCreateProject(), updateTask = useUpdateTask(), updateProject = useUpdateProject()
  const [prefs, setPrefs] = useState<Preferences>(defaults)
  const [selection, setSelection] = useState<WorkspaceSelection>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)
  const initialExpansion = useRef(false)
  const [fullTaskId, setFullTaskId] = useState<string | null>(null)
  const [utility, setUtility] = useState<'projects' | 'execution' | null>(null)
  const [createKind, setCreateKind] = useState<'task' | 'topic' | 'project' | null>(null)
  const [title, setTitle] = useState(''), [newProject, setNewProject] = useState(''), [newTopic, setNewTopic] = useState('')
  const [newType, setNewType] = useState(''), [newDue, setNewDue] = useState('')
  const [saving, setSaving] = useState(false), [formError, setFormError] = useState('')
  const [topicName, setTopicName] = useState(''), [topicSaving, setTopicSaving] = useState(false), [topicError, setTopicError] = useState('')
  const [deleteTopicOpen, setDeleteTopicOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [newParent, setNewParent] = useState<Task | null>(null)
  const [rename, setRename] = useState<{ target: NonNullable<WorkspaceSelection>; name: string } | null>(null)
  const [renameSaving, setRenameSaving] = useState(false), [renameError, setRenameError] = useState('')
  const [ownershipTaskId, setOwnershipTaskId] = useState<string | null>(null)
  const tableScroll = useRef<HTMLDivElement>(null)
  const { sizes, setSize } = useWorkspaceLayout()
  const [narrow, setNarrow] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const paneId = useId()

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width:1000px)')
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || 'null')
      if (saved && typeof saved === 'object') {
        setPrefs({ ...defaults, ...saved.prefs, view: ['linked', 'list', 'graph'].includes(saved.prefs?.view) ? saved.prefs.view : defaults.view })
        if (saved.selection && ['project', 'topic', 'task'].includes(saved.selection.kind) && typeof saved.selection.id === 'string' && saved.selection.id) setSelection({ kind: saved.selection.kind, id: saved.selection.id })
        if (Array.isArray(saved.expanded)) { setExpanded(new Set(saved.expanded.filter((id: unknown) => typeof id === 'string'))); initialExpansion.current = true }
      } else if (window.innerWidth < 900) setPrefs(previous => ({ ...previous, view: 'list' }))
    } catch { /* Storage can be disabled; the workspace remains fully usable. */ }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (sidebarProject) { setPrefs(previous => ({ ...previous, project: sidebarProject === '__all__' ? '' : sidebarProject })); setSelection(null); useTaskStore.getState().setSelectedProjectId(null) }
  }, [sidebarProject])
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(preferenceKey, JSON.stringify({ prefs, selection, expanded: [...expanded] })) } catch {}
  }, [prefs, selection, expanded, hydrated])

  const projects = useMemo(() => ((projectsQuery.data || []) as Record<string, unknown>[]).map(project => ({ ...mapApiProject(project), archived: Boolean(project.archived) })), [projectsQuery.data])
  const rawTasks = useMemo(() => ((tasksQuery.data || []) as Record<string, unknown>[]).map(mapApiTask), [tasksQuery.data])
  const tasks = useMemo(() => resolveTaskOwnership(rawTasks).filter(task => !task.archived), [rawTasks])
  const topics = useMemo(() => topicsQuery.data || [], [topicsQuery.data])
  const visibleProjects = useMemo(() => projects.filter(project => prefs.archived || !project.archived), [projects, prefs.archived])
  const allGroups = useMemo(() => workspaceGroups(projects, topics, tasks, zh ? '未分配项目' : 'Unassigned project', zh ? '未分类' : 'Unclassified'), [projects, topics, tasks, zh])
  const scope = selectedScope(selection, allGroups, tasks) || (prefs.project ? { projectId: prefs.project } : null)
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map(project => project.id)), [visibleProjects])
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])
  const topicNames = useMemo(() => new Map(topics.map(topic => [topic.id, topic.name])), [topics])
  const searchable = useMemo(() => tasks.filter(task => {
    if (task.projectId && projectNames.has(task.projectId) && !visibleProjectIds.has(task.projectId)) return false
    if (prefs.project && (task.projectId || INBOX) !== prefs.project) return false
    if (prefs.type && taskType(task) !== prefs.type) return false
    const needle = prefs.search.trim().toLocaleLowerCase()
    return !needle || [task.title, task.description, task.sourceProject, taskType(task), task.projectId ? projectNames.get(task.projectId) : '', task.topicId ? topicNames.get(task.topicId) : '', ...task.tags, ...taskAncestors(task, tasks).map(parent => parent.title)].join(' ').toLocaleLowerCase().includes(needle)
  }), [tasks, prefs.project, prefs.type, prefs.search, visibleProjectIds, projectNames, topicNames])
  const counts = Object.fromEntries(statuses.map(status => [status, searchable.filter(task => status === 'all' || (status === 'overdue' ? overdue(task) : task.status === status)).length]))
  const filteredTasks = useMemo(() => {
    const selected = searchable.filter(task => prefs.status === 'all' || (prefs.status === 'overdue' ? overdue(task) : task.status === prefs.status))
    return selected.sort((a, b) => compareWorkspaceTasks(a, b, prefs.sort, prefs.ascending, zh ? 'zh-CN' : 'en'))
  }, [searchable, prefs.status, prefs.sort, prefs.ascending, zh])
  const matchedIds = useMemo(() => new Set(filteredTasks.map(task => task.id)), [filteredTasks])
  const contextTasks = useMemo(() => withTaskAncestors(filteredTasks, tasks), [filteredTasks, tasks])
  const filtering = Boolean(prefs.search.trim() || prefs.type || prefs.status !== 'all')
  const graphGroups = useMemo(() => workspaceGroups(visibleProjects.filter(project => !prefs.project || project.id === prefs.project), topics, contextTasks, zh ? '未分配项目' : 'Unassigned project', zh ? '未分类' : 'Unclassified')
    .filter(group => (!prefs.project || group.id === prefs.project) && (!filtering || group.tasks.length > 0 || Boolean(prefs.search.trim()) && [group.name, ...group.topics.map(topic => topic.name)].some(name => name.toLocaleLowerCase().includes(prefs.search.trim().toLocaleLowerCase())))), [visibleProjects, topics, contextTasks, prefs.project, filtering, prefs.search, zh])
  const tableGroups = graphGroups
  const scopedTasks = filteredTasks.filter(task => !scope || graphGroups.some(group => group.id === scope.projectId && group.topics.some(topic => (!scope.topicId || topic.id === scope.topicId) && topic.tasks.some(item => item.id === task.id))))
  const selectedTask = selection?.kind === 'task' ? tasks.find(task => task.id === selection.id) : null
  const selectedTopic = selection?.kind === 'topic' ? topics.find(topic => `${topic.projectId}:${topic.id}` === selection.id) : null
  const selectedProject = scope ? projects.find(project => project.id === scope.projectId) : null
  const typeOptions = [...new Set(tasks.map(taskType).filter(Boolean))].sort()
  const loading = tasksQuery.isLoading || projectsQuery.isLoading || topicsQuery.isLoading
  const failed = tasksQuery.isError || projectsQuery.isError || topicsQuery.isError

  useEffect(() => {
    if (!hydrated || loading || initialExpansion.current || !allGroups.length) return
    initialExpansion.current = true
    const first = allGroups.find(group => group.tasks.length) || allGroups[0]
    setExpanded(new Set([`project:${first.id}`, ...(first.topics[0] && first.topics[0].tasks.length <= 8 ? [`topic:${first.topics[0].id}`, ...first.tasks.filter(task => first.tasks.some(child => child.parentTaskId === task.id)).map(task => `task:${task.id}`)] : [])]))
  }, [allGroups, hydrated, loading])
  useEffect(() => { setTopicName(selectedTopic?.name || ''); setTopicError('') }, [selectedTopic?.id, selectedTopic?.name])
  useEffect(() => {
    if (selection?.kind !== 'task') return
    const row = Array.from(tableScroll.current?.querySelectorAll<HTMLElement>('[data-workspace-task]') || []).find(row => row.dataset.workspaceTask === selection.id)
    row?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [selection, page, prefs.view])
  const toggleExpanded = useCallback((id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }), [])
  const select = useCallback((next: WorkspaceSelection) => {
    setSelection(next); setPage(0)
    if (!next) { setPrefs(previous => ({ ...previous, project: '' })); return }
    const target = selectedScope(next, allGroups, tasks)
    if (target) {
      setPrefs(previous => previous.project && previous.project !== target.projectId ? { ...previous, project: target.projectId } : previous)
      const task = next.kind === 'task' ? tasks.find(task => task.id === next.id) : null
      const chain = task ? [task, ...taskAncestors(task, tasks)] : []
      const owners = [target, ...chain.map(item => selectedScope({ kind: 'task', id: item.id }, allGroups, tasks))]
      setExpanded(previous => new Set([...previous,
        ...owners.flatMap(owner => owner ? [`project:${owner.projectId}`, ...(owner.topicId ? [`topic:${owner.topicId}`] : [])] : []),
        ...chain.map(item => `task:${item.id}`),
      ]))
    }
  }, [allGroups, tasks])
  const selectGraph = select
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setPrefs(previous => ({ ...previous, [key]: value })); setPage(0); if (['search', 'status', 'type', 'project'].includes(key)) setExpanded(new Set([...allGroups.flatMap(group => [`project:${group.id}`, ...group.topics.map(topic => `topic:${topic.id}`)]), ...tasks.filter(task => tasks.some(child => child.parentTaskId === task.id)).map(task => `task:${task.id}`)])) }
  const reset = () => { setPrefs(previous => ({ ...defaults, view: previous.view, project: previous.project })); setPage(0) }
  const openCreate = (kind: 'task' | 'topic' | 'project', target = selection, parent: Task | null = null) => {
    const targetScope = selectedScope(target, allGroups, tasks)
    const targetTask = target?.kind === 'task' ? tasks.find(task => task.id === target.id) : null
    const targetTopic = target?.kind === 'topic' ? topics.find(topic => `${topic.projectId}:${topic.id}` === target.id) : null
    setNewParent(parent)
    setTitle(''); setNewType(''); setNewDue(''); setFormError('')
    setNewProject(parent?.projectId || (targetScope?.projectId !== INBOX ? targetScope?.projectId : '') || (prefs.project !== INBOX ? prefs.project : '') || '')
    setNewTopic(parent?.topicId || targetTopic?.id || targetTask?.topicId || '')
    setCreateKind(kind)
  }
  const refreshTopics = () => qc.invalidateQueries({ queryKey: ['project-topics'] })
  const submitCreate = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; setSaving(true); setFormError('')
    try {
      if (createKind === 'task') {
        const created = await createTask.mutateAsync({ title: title.trim(), parentTaskId: newParent?.id || null, projectId: newProject || null, topicId: newTopic || null, taskType: newType.trim() || null, dueDate: newDue || null, status: 'todo', priority: 'medium' }) as { id: string }
        setPrefs(previous => ({ ...previous, search: '', project: previous.project ? newProject || INBOX : '', type: '', status: 'all' })); select({ kind: 'task', id: created.id })
        setExpanded(previous => new Set([...previous, `project:${newProject || INBOX}`, `topic:${newProject || INBOX}:${newTopic || '__unclassified__'}`, ...(newParent ? [newParent, ...taskAncestors(newParent, tasks)].map(task => `task:${task.id}`) : [])]))
      } else if (createKind === 'topic') {
        const created = await apiPost<ProjectTopic>('/api/topics', { name: title.trim(), projectId: newProject }); await refreshTopics()
        select({ kind: 'topic', id: `${created.projectId}:${created.id}` }); setExpanded(previous => new Set([...previous, `project:${created.projectId}`, `topic:${created.projectId}:${created.id}`]))
        setPrefs(previous => ({ ...previous, search: '', project: previous.project ? newProject || INBOX : '', type: '', status: 'all' }))
      } else {
        const created = await createProject.mutateAsync({ name: title.trim(), color: '#0f766e', status: 'active' }) as { id: string }
        select({ kind: 'project', id: created.id }); setPrefs(previous => ({ ...previous, search: '', project: previous.project ? created.id : '', type: '', status: 'all' }))
      }
      setCreateKind(null); toast.success(say('已创建', 'Created'))
    } catch (error) { setFormError(error instanceof Error ? error.message : say('创建失败，请重试', 'Could not create. Please retry.')) }
    finally { setSaving(false) }
  }
  const saveTopic = async (remove = false) => {
    if (!selectedTopic) return; setTopicSaving(true); setTopicError('')
    try {
      if (remove) { await apiDelete(`/api/topics/${selectedTopic.id}`); setSelection({ kind: 'project', id: selectedTopic.projectId }); setDeleteTopicOpen(false); await qc.invalidateQueries({ queryKey: ['tasks'] }) }
      else await apiPatch(`/api/topics/${selectedTopic.id}`, { name: topicName.trim() })
      await refreshTopics(); toast.success(say(remove ? '主题已删除，任务已移入未分类' : '主题已保存', remove ? 'Topic deleted; tasks are now unclassified' : 'Topic saved'))
    } catch (error) { setTopicError(error instanceof Error ? error.message : say('操作失败，请重试', 'Could not save. Please retry.')) }
    finally { setTopicSaving(false) }
  }

  const beginRename = (target: NonNullable<WorkspaceSelection>, name: string) => { setRename({ target, name }); setRenameError('') }
  const submitRename = async (event: FormEvent) => {
    event.preventDefault(); if (!rename?.name.trim()) return
    setRenameSaving(true); setRenameError('')
    try {
      if (rename.target.kind === 'task') await updateTask.mutateAsync({ id: rename.target.id, title: rename.name.trim() })
      else if (rename.target.kind === 'project') await updateProject.mutateAsync({ id: rename.target.id, name: rename.name.trim() })
      else {
        const topic = topics.find(topic => `${topic.projectId}:${topic.id}` === rename.target.id)
        if (!topic) {
          const group = allGroups.find(group => group.project && rename.target.id === `${group.id}:${UNCLASSIFIED}`)
          if (!group) throw new Error(say('请先为这些任务分配项目', 'Assign these tasks to a project first.'))
          const created = await apiPost<ProjectTopic & { movedTaskCount: number; skippedTaskCount: number }>('/api/topics', { name: rename.name.trim(), projectId: group.id, fromUnclassified: true })
          await Promise.all([refreshTopics(), qc.invalidateQueries({ queryKey: ['tasks'] })])
          setPrefs(previous => ({ ...previous, search: '', type: '', status: 'all' }))
          select({ kind: 'topic', id: `${group.id}:${created.id}` })
          setExpanded(previous => new Set([...previous, `project:${group.id}`, `topic:${group.id}:${created.id}`]))
          if (created.skippedTaskCount) toast.warning(say('部分任务已被其他操作更新，保留其最新归属，请刷新核对。', 'Some tasks changed concurrently; their latest ownership was preserved. Refresh to review.'))
        } else { await apiPatch(`/api/topics/${topic.id}`, { name: rename.name.trim() }); await refreshTopics() }
      }
      setRename(null); toast.success(say('名称已更新', 'Name updated'))
    } catch (error) { setRenameError(error instanceof Error ? error.message : say('重命名失败，请重试', 'Could not rename. Please retry.')) }
    finally { setRenameSaving(false) }
  }
  const menuFor = (target: NonNullable<WorkspaceSelection>): WorkspaceMenu | undefined => {
    const project = target.kind === 'project' ? projects.find(item => item.id === target.id) : null
    const topic = target.kind === 'topic' ? topics.find(item => `${item.projectId}:${item.id}` === target.id) : null
    const task = target.kind === 'task' ? tasks.find(item => item.id === target.id) : null
    const label = project?.name || topic?.name || task?.title || (target.id === INBOX ? say('未分配项目', 'Unassigned project') : say('未分类', 'Unclassified'))
    const actions: WorkspaceMenu['actions'] = []
    const unclassifiedGroup = target.kind === 'topic' && allGroups.some(group => group.project && target.id === `${group.id}:${UNCLASSIFIED}`)
    if (project || topic || task || unclassifiedGroup) actions.push({ id: 'rename', label: say('重命名', 'Rename'), run: () => beginRename(target, label) })
    if (task) {
      actions.push({ id: 'details', label: say('打开完整详情', 'Full details'), run: () => setFullTaskId(task.id) },
        { id: 'subtask', label: say('新建子任务', 'New subtask'), run: () => openCreate('task', target, task) },
        { id: 'ownership', label: say('调整项目与主题', 'Change project & topic'), run: () => setOwnershipTaskId(task.id) },
        { id: 'status', label: task.status === 'done' ? say('重新打开', 'Reopen task') : say('标记完成', 'Mark complete'), disabled: updateTask.isPending, run: () => { void updateTask.mutateAsync({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' }).then(() => toast.success(say('任务状态已更新', 'Task status updated'))).catch(error => toast.error(error instanceof Error ? error.message : say('更新失败，请重试', 'Could not update. Please retry.'))) } })
      if (task.parentTaskId && tasks.some(parent => parent.id === task.parentTaskId)) actions.push({ id: 'parent', label: say('查看父任务', 'View parent task'), run: () => { reset(); select({ kind: 'task', id: task.parentTaskId! }) } })
    } else {
      if (project) actions.push({ id: 'topic', label: say('新建主题', 'New topic'), run: () => openCreate('topic', target) })
      actions.push({ id: 'task', label: say('新建任务', 'New task'), run: () => openCreate('task', target) })
    }
    if (target.kind !== 'task' || tasks.some(child => child.parentTaskId === target.id)) {
      actions.push({ id: 'expand', label: expanded.has(`${target.kind}:${target.id}`) ? say('收起下级', 'Collapse children') : say('展开下级', 'Expand children'), run: () => toggleExpanded(`${target.kind}:${target.id}`) })
    }
    if (project) actions.push({ id: 'manage', label: say('管理项目', 'Manage projects'), run: () => setUtility('projects') })
    if (topic) actions.push({ id: 'delete', label: say('删除主题…', 'Delete topic…'), destructive: true, run: () => { select(target); setDeleteTopicOpen(true) } })
    return { label, actions, onOpen: () => { setSelection(target); setPage(0) } }
  }
  const sortColumn = (field: WorkspaceSort) => {
    setPrefs(previous => ({ ...previous, sort: field, ascending: previous.sort === field ? !previous.ascending : !['updated', 'due'].includes(field) })); setPage(0)
  }
  const sortableHeader = (field: WorkspaceSort, label: string) => <th scope="col" aria-sort={prefs.sort === field ? (prefs.ascending ? 'ascending' : 'descending') : 'none'}><button type="button" className="workspace-column-sort" onClick={() => sortColumn(field)}>{label}{prefs.sort === field ? (prefs.ascending ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />) : <ArrowUpDown size={13} aria-hidden />}</button></th>

  if (utility) return <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-4 py-2"><Button variant="ghost" className="gap-2" onClick={() => setUtility(null)}><ChevronRight size={16} className="rotate-180" />{say('返回项目与任务', 'Back to projects & tasks')}</Button><span className="text-sm text-muted-foreground">{utility === 'execution' ? say('周期与任务执行', 'Recurring tasks & execution') : say('项目管理', 'Project management')}</span></div><div className="min-h-0 flex-1 overflow-auto">{utility === 'projects' ? <ProjectsPage /> : <TasksPage />}</div></div>
  const taskRow = (task: Task, depth = 0, children = 0) => {
    const target = { kind: 'task' as const, id: task.id }, menu = menuFor(target)!
    const contextOnly = !matchedIds.has(task.id), opened = expanded.has(`task:${task.id}`)
    const path = [projectNames.get(task.projectId || '') || say('未分配项目', 'Unassigned project'), topicNames.get(task.topicId || '') || say('未分类', 'Unclassified'), ...taskAncestors(task, tasks).reverse().map(parent => parent.title)].join(' / ')
    return <WorkspaceContextMenu key={task.id} menu={menu}><tr data-workspace-task={task.id} data-context-only={contextOnly || undefined} data-parent-task={task.parentTaskId || undefined} className={selectedTask?.id === task.id ? 'is-selected' : ''} aria-selected={selectedTask?.id === task.id}>
      <td><div className="workspace-task-cell" style={prefs.grouped ? { paddingInlineStart: `${32 + Math.min(depth, 5) * 18}px` } : undefined}>
        {prefs.grouped && children > 0 && <button type="button" className="workspace-collapse" aria-expanded={opened} aria-label={`${say('展开或收起子任务', 'Expand or collapse subtasks')} ${task.title}`} onClick={() => toggleExpanded(`task:${task.id}`)}>{opened ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
        <button type="button" className="workspace-row-name" onClick={() => select(target)} onDoubleClick={() => menu.actions.find(action => action.id === 'rename')?.run()}><FileText size={17} aria-hidden /><span className="min-w-0"><span className="workspace-task-title" title={task.title}>{task.title}</span>{(!prefs.grouped || task.parentTaskId || contextOnly || children > 0) && <span className="workspace-row-path" title={path}>{contextOnly ? say('父任务 · 筛选上下文', 'Parent · filter context') : !prefs.grouped ? path : task.parentTaskId ? `${say('父任务：', 'Parent: ')}${tasks.find(parent => parent.id === task.parentTaskId)?.title || say('已归档或不可见', 'Archived or unavailable')}` : `${children} ${say('项子任务', 'subtasks')}`}</span>}</span></button>
        <WorkspaceActionsButton menu={menu} zh={zh} />
      </div></td>
      <td><span className="workspace-type">{taskType(task) || '—'}</span></td><td><span className={`workspace-status status-${task.status}`}>{labels[task.status] || task.status}</span>{overdue(task) && <span className="ml-1 text-xs text-destructive">{say('逾期', 'Overdue')}</span>}</td><td><time title={task.updatedAt} dateTime={task.updatedAt}>{dateLabel(task.updatedAt, zh)}</time></td><td><time dateTime={task.dueDate || undefined} className={overdue(task) ? 'text-destructive' : ''}>{dateInput(task.dueDate) || '—'}</time></td>
    </tr></WorkspaceContextMenu>
  }
  const graphExpanded = expanded
  const rows: React.ReactNode[] = []
  if (prefs.grouped) {
    for (const group of tableGroups) {
      const projectNode = `project:${group.id}`, opened = expanded.has(projectNode), projectTarget = { kind: 'project' as const, id: group.id }, projectMenu = menuFor(projectTarget)!
      rows.push(<WorkspaceContextMenu key={projectNode} menu={projectMenu}><tr className="workspace-group"><td><div className="workspace-task-cell"><button type="button" className="workspace-collapse" aria-label={`${say('展开或收起项目', 'Expand or collapse project')} ${group.name}`} aria-expanded={opened} onClick={() => toggleExpanded(projectNode)}>{opened ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="workspace-row-name" onClick={() => select(projectTarget)} onDoubleClick={() => projectMenu.actions.find(action => action.id === 'rename')?.run()}><Folder size={18} /><span className="truncate font-semibold" title={group.name}>{group.name}</span><span className="text-xs text-muted-foreground">{group.tasks.filter(task => matchedIds.has(task.id)).length}</span></button><WorkspaceActionsButton menu={projectMenu} zh={zh} /></div></td><td>{say('项目', 'Project')}</td><td>{group.project?.status ? ({ active: say('进行中', 'Active'), 'on-hold': say('暂停', 'On hold'), completed: say('已完成', 'Completed'), cancelled: say('已取消', 'Cancelled') }[group.project.status] || group.project.status) : '—'}</td><td>{dateLabel(group.project?.updatedAt, zh)}</td><td>{dateInput(group.project?.endDate || null) || '—'}</td></tr></WorkspaceContextMenu>)
      if (!opened) continue
      for (const topic of group.topics) {
        const topicNode = `topic:${topic.id}`, topicOpen = expanded.has(topicNode), topicTarget = { kind: 'topic' as const, id: topic.id }, topicMenu = menuFor(topicTarget)!
        rows.push(<WorkspaceContextMenu key={topicNode} menu={topicMenu}><tr className="workspace-topic"><td><div className="workspace-task-cell pl-5"><button type="button" className="workspace-collapse" aria-label={`${say('展开或收起主题', 'Expand or collapse topic')} ${topic.name}`} aria-expanded={topicOpen} onClick={() => toggleExpanded(topicNode)}>{topicOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="workspace-row-name" onClick={() => select(topicTarget)} onDoubleClick={() => topicMenu.actions.find(action => action.id === 'rename')?.run()}><Layers size={17} /><span className="truncate" title={topic.name}>{topic.name}</span><span className="text-xs text-muted-foreground">{topic.tasks.filter(task => matchedIds.has(task.id)).length}</span></button><WorkspaceActionsButton menu={topicMenu} zh={zh} /></div></td><td>{say('主题', 'Topic')}</td><td>—</td><td>{dateLabel(topic.topic?.updatedAt, zh)}</td><td>—</td></tr></WorkspaceContextMenu>)
        const renderBranches = (branches: ReturnType<typeof taskTree>, depth = 0) => {
          for (const { task, children } of branches) {
            rows.push(taskRow(task, depth, children.length))
            if (expanded.has(`task:${task.id}`)) renderBranches(children, depth + 1)
          }
        }
        if (topicOpen) renderBranches(taskTree(topic.tasks))
      }
    }
  } else rows.push(...scopedTasks.map(task => taskRow(task)))
  const pageSize = Math.max(80, rows.length), pages = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pages - 1)

  return <div className="project-workspace" data-testid="project-workspace">
    <header className="workspace-header"><div><h1>{say('项目与任务', 'Projects & tasks')}</h1><p>{say('用关系图梳理结构，用列表推进任务', 'Map the structure. Move the work forward.')}</p></div><div className="flex flex-wrap items-center gap-2"><div className="workspace-view-switch" role="group" aria-label={say('视图', 'Workspace view')}>{([{ id: 'linked', label: say('联动', 'Linked'), icon: PanelLeftClose }, { id: 'list', label: say('列表', 'List'), icon: List }, { id: 'graph', label: say('关系图', 'Graph'), icon: Network }] as const).map(view => <button key={view.id} aria-pressed={prefs.view === view.id} onClick={() => change('view', view.id)}><view.icon size={15} /><span>{view.label}</span></button>)}</div><Button className="h-10 gap-1.5" onClick={() => openCreate('task')}><Plus size={16} />{say('新建', 'New')}</Button><details className="workspace-mobile-more"><summary aria-label={say('更多操作', 'More actions')}><Settings2 size={17} /></summary><div><button onClick={() => openCreate('project')}>{say('新建项目', 'New project')}</button><button onClick={() => openCreate('topic')}>{say('新建主题', 'New topic')}</button><button onClick={() => setUtility('projects')}>{say('管理项目', 'Manage projects')}</button><button onClick={() => setUtility('execution')}>{say('周期与执行', 'Recurring & execution')}</button></div></details></div></header>
    <div className="workspace-toolbar"><div className="workspace-search"><Search size={17} /><Input aria-label={say('搜索项目、主题或任务', 'Search projects, topics or tasks')} placeholder={say('搜索项目、主题或任务', 'Search projects, topics or tasks')} value={prefs.search} onChange={event => change('search', event.target.value)} />{prefs.search && <button aria-label={say('清除搜索', 'Clear search')} onClick={() => change('search', '')}><X size={15} /></button>}</div>
      <select aria-label={say('项目筛选', 'Project filter')} value={prefs.project} onChange={event => { change('project', event.target.value); setSelection(null) }}><option value="">{say('全部项目', 'All projects')}</option><option value={INBOX}>{say('未分配项目', 'Unassigned project')}</option>{visibleProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label={say('类型筛选', 'Type filter')} value={prefs.type} onChange={event => change('type', event.target.value)}><option value="">{say('全部类型', 'All types')}</option>{typeOptions.map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label={say('排序字段', 'Sort by')} value={prefs.sort} onChange={event => change('sort', event.target.value as Preferences['sort'])}><option value="updated">{say('最近更新', 'Last updated')}</option><option value="name">{say('名称', 'Name')}</option><option value="type">{say('类型', 'Type')}</option><option value="status">{say('状态', 'Status')}</option><option value="due">{say('截止日期', 'Due date')}</option></select><button className="workspace-sort" aria-label={prefs.ascending ? say('切换为降序', 'Sort descending') : say('切换为升序', 'Sort ascending')} onClick={() => change('ascending', !prefs.ascending)}>{prefs.ascending ? <ArrowUp size={18} /> : <ArrowDown size={18} />}</button>
    </div>
    <div className="workspace-filter-bar"><div role="group" aria-label={say('任务筛选', 'Task filters')} className="workspace-status-filters">{statuses.map(status => <button key={status} aria-pressed={prefs.status === status} onClick={() => change('status', status)}>{labels[status]} <span>{counts[status] || 0}</span></button>)}</div><div className="workspace-tools"><button onClick={() => openCreate('project')}><Plus size={14} />{say('项目', 'Project')}</button><button onClick={() => openCreate('topic')}><Plus size={14} />{say('主题', 'Topic')}</button><button title={say('管理项目', 'Manage projects')} aria-label={say('管理项目', 'Manage projects')} onClick={() => setUtility('projects')}><Settings2 size={16} /></button><button onClick={() => setUtility('execution')}>{say('周期与执行', 'Recurring & execution')}<ExternalLink size={13} /></button></div></div>
    {loading ? <div className="workspace-message" role="status"><LoaderCircle className="animate-spin" size={24} />{say('正在读取项目与任务…', 'Loading projects and tasks…')}</div> : failed ? <div className="workspace-message" role="alert"><p>{say('项目或任务读取失败，请重试。', 'Could not load projects or tasks. Please retry.')}</p><Button variant="outline" onClick={() => { void tasksQuery.refetch(); void projectsQuery.refetch(); void topicsQuery.refetch() }}>{say('重试', 'Retry')}</Button></div> : <div className={`workspace-body view-${prefs.view}`} ref={bodyRef} style={prefs.view === 'linked' ? ({ '--workspace-graph-first': `${sizes[narrow ? 'stacked' : 'desktop']}fr`, '--workspace-graph-second': `${100 - sizes[narrow ? 'stacked' : 'desktop']}fr` } as CSSProperties) : undefined}>
      {prefs.view !== 'list' && <section className="workspace-map" id={`${paneId}-map`} aria-label={say('关系图', 'Relationship graph')}><div className="workspace-pane-heading"><div><h2>{say('关系图', 'Relationship graph')}</h2><p>{say('项目 → 主题 → 任务 → 子任务', 'Project → Topic → Task → Subtask')}</p></div><Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>{say('收起全部', 'Collapse all')}</Button></div><div className="workspace-canvas">{graphGroups.length ? <WorkspaceGraph groups={graphGroups} selection={selection} expanded={graphExpanded} onExpand={toggleExpanded} onSelect={selectGraph} menuFor={menuFor} matchedIds={matchedIds} zh={zh} /> : <div className="workspace-message"><Inbox size={30} /><p>{say('没有匹配的项目或任务', 'No matching projects or tasks')}</p><Button variant="outline" onClick={reset}>{say('清除筛选', 'Clear filters')}</Button></div>}</div><p className="workspace-map-hint">{say('滚轮上下平移 · 拖动节点调整位置 · 双击或右键重命名 · 拖动空白移动画布', 'Scroll to pan vertically · Drag nodes to arrange · Double-click or right-click to rename · Drag background to pan')}</p></section>}
      {prefs.view === 'linked' && <WorkspaceResizeHandle axis={narrow ? 'y' : 'x'} value={sizes[narrow ? 'stacked' : 'desktop']} onChange={value => setSize(narrow ? 'stacked' : 'desktop', value)} containerRef={bodyRef} defaultValue={narrow ? 42 : 43} label={say(narrow ? '调整关系图与列表高度' : '调整关系图与列表宽度', narrow ? 'Resize graph and list height' : 'Resize graph and list width')} controls={`${paneId}-map ${paneId}-list`} />}
      {prefs.view !== 'graph' && <section className="workspace-list" id={`${paneId}-list`} aria-label={say('任务列表', 'Task list')}><div className="workspace-pane-heading"><div className="min-w-0"><h2 className="truncate">{prefs.grouped ? (prefs.project ? graphGroups[0]?.name || say('项目筛选结果', 'Project filter') : filtering ? say('筛选结果', 'Filtered results') : say('全部项目', 'All projects')) : selectedProject?.name || (scope?.projectId === INBOX ? say('未分配项目', 'Unassigned project') : say('全部项目', 'All projects'))}{!prefs.grouped && scope?.topicId && <span className="text-sm font-normal"> / {selectedTopic?.name || (selectedTask?.topicId ? topicNames.get(selectedTask.topicId) : null) || say('未分类', 'Unclassified')}</span>}</h2><p aria-live="polite">{prefs.grouped ? filteredTasks.length : scopedTasks.length} {say('项任务', 'tasks')}{filtering ? say(' · 已筛选', ' · filtered') : ''}</p></div><div className="flex shrink-0 items-center gap-2">{selection && <button className="workspace-text-button" onClick={() => select(null)}>{say('查看全部', 'View all')}</button>}<button className="workspace-text-button" onClick={() => change('grouped', !prefs.grouped)}>{prefs.grouped ? say('平铺', 'Flat list') : say('按层级', 'Hierarchy')}</button></div></div>
        <div className="workspace-list-content" ref={contentRef} id={paneId} style={{ '--workspace-table-first': `${sizes.table}fr`, '--workspace-table-second': `${100 - sizes.table}fr` } as CSSProperties}>
          <div className="workspace-table-area" id={`${paneId}-table`}>
            <div className="workspace-table-scroll" ref={tableScroll}><table className="workspace-table"><caption className="sr-only">{say('项目、主题、任务与类型、状态、更新日期及截止日期', 'Projects, topics and tasks with type, status, updated and due dates')}</caption><thead><tr>{sortableHeader('name', say('名称', 'Name'))}{sortableHeader('type', say('类型', 'Type'))}{sortableHeader('status', say('状态', 'Status'))}{sortableHeader('updated', say('更新日期', 'Updated'))}{sortableHeader('due', say('截止日期', 'Due date'))}</tr></thead><tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}</tbody></table>{!rows.length && <div className="workspace-message"><FileText size={28} /><p>{say('没有匹配的项目或任务', 'No matching projects or tasks')}</p><Button variant="outline" onClick={reset}>{say('清除筛选', 'Clear filters')}</Button></div>}</div>
        {pages > 1 && <div className="workspace-pagination"><Button variant="ghost" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{say('上一页', 'Previous')}</Button><span>{currentPage + 1} / {pages}</span><Button variant="ghost" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{say('下一页', 'Next')}</Button></div>}
          </div>
          <WorkspaceResizeHandle axis='y' value={sizes.table} onChange={value => setSize('table', value)} containerRef={contentRef} defaultValue={60} label={say('调整任务列表与详情高度', 'Resize task list and details')} controls={`${paneId}-table ${paneId}-detail`} />
          <div className='workspace-detail' id={`${paneId}-detail`}>
        {selectedTask ? <TaskInspector key={`${selectedTask.id}:${selectedTask.updatedAt}`} task={rawTasks.find(task => task.id === selectedTask.id)!} effectiveTask={selectedTask} parent={tasks.find(task => task.id === selectedTask.parentTaskId)} onParent={() => select({ kind: 'task', id: selectedTask.parentTaskId! })} projects={projects} topics={topics} zh={zh} onFull={() => setFullTaskId(selectedTask.id)} /> : selectedTopic ? <section className="workspace-inspector"><h3 className="text-lg font-semibold">{selectedTopic.name}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedProject?.name} / {say('主题', 'Topic')}</p><form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void saveTopic() }}><Input aria-label={say('主题名称', 'Topic name')} value={topicName} maxLength={120} onChange={event => setTopicName(event.target.value)} className="min-w-0 flex-1" /><Button type="submit" disabled={topicSaving || !topicName.trim() || topicName.trim() === selectedTopic.name}>{say('保存', 'Save')}</Button><Button type="button" variant="ghost" className="text-destructive" disabled={topicSaving} onClick={() => setDeleteTopicOpen(true)}>{say('删除主题', 'Delete topic')}</Button></form>{topicError && <p role="alert" className="mt-2 text-sm text-destructive">{topicError}</p>}</section> : <section className="workspace-inspector workspace-idle"><Layers size={22} /><div><p className="font-medium">{selectedProject?.name || say('从结构到行动', 'From structure to action')}</p><p className="mt-1 text-sm text-muted-foreground">{say(scope?.projectId === INBOX ? '这里仅收纳未分配项目的任务；有父任务归属的子任务会随父任务展示。' : '选择任务查看详情，或为项目新建主题。', scope?.projectId === INBOX ? 'Only tasks without project ownership appear here. Subtasks follow their parent’s ownership.' : 'Select a task to see details, or add a topic to a project.')}</p></div>{selectedProject && <Button variant="outline" size="sm" onClick={() => openCreate('topic')}>{say('新建主题', 'New topic')}</Button>}</section>}
          <TaskNotes taskId={selectedTask?.id || null} taskTitle={selectedTask?.title} zh={zh} />
          </div>
        </div>
      </section>}
    </div>}
    <footer className="workspace-footer"><span>{say('图和列表共享数据，筛选与选中状态同步', 'Shared data, filters and selection across both views')}</span><label><input type="checkbox" checked={prefs.archived} onChange={event => change('archived', event.target.checked)} />{say('显示归档项目', 'Show archived projects')}</label>{filtering && <button onClick={reset}>{say('清除筛选', 'Clear filters')}</button>}</footer>
    <Dialog open={createKind !== null} onOpenChange={open => { if (!open && !saving) setCreateKind(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{createKind === 'task' ? (newParent ? say('新建子任务', 'New subtask') : say('新建任务', 'New task')) : createKind === 'topic' ? say('新建主题', 'New topic') : say('新建项目', 'New project')}</DialogTitle><DialogDescription>{createKind === 'topic' ? say('主题属于一个项目，用来归集相关任务。', 'A topic belongs to one project and groups related tasks.') : say('保存后可继续补充详情。', 'You can add more detail after saving.')}</DialogDescription></DialogHeader><form onSubmit={submitCreate} className="space-y-4">{newParent && <p className="workspace-parent-path">{say('父任务：', 'Parent task: ')}{newParent.title}</p>}<label className="workspace-form-label">{say('名称', 'Name')}<Input autoFocus required value={title} maxLength={createKind === 'topic' ? 120 : createKind === 'project' ? 180 : 500} onChange={event => setTitle(event.target.value)} /></label>{createKind !== 'project' && <div className="workspace-fields"><label>{say('所属项目', 'Project')}<select required={createKind === 'topic'} value={newProject} onChange={event => { setNewProject(event.target.value); setNewTopic('') }}><option value="">{createKind === 'topic' ? say('选择项目', 'Select a project') : say('未分配项目', 'Unassigned project')}</option>{visibleProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{createKind === 'task' && <><label>{say('所属主题', 'Topic')}<select value={newTopic} disabled={!newProject} onChange={event => setNewTopic(event.target.value)}><option value="">{say('未分类', 'Unclassified')}</option>{topics.filter(topic => topic.projectId === newProject).map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><label>{say('类型', 'Type')}<input maxLength={60} value={newType} placeholder={say('需求、缺陷、研究…', 'Requirement, bug, research…')} onChange={event => setNewType(event.target.value)} /></label><label>{say('截止日期', 'Due date')}<input type="date" value={newDue} onChange={event => setNewDue(event.target.value)} /></label></>}</div>}{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setCreateKind(null)}>{say('取消', 'Cancel')}</Button><Button type="submit" disabled={saving || !title.trim()}>{saving ? say('正在保存…', 'Saving…') : say('创建', 'Create')}</Button></div></form></DialogContent></Dialog>
    <Dialog open={deleteTopicOpen} onOpenChange={open => { if (!topicSaving) setDeleteTopicOpen(open) }}><DialogContent><DialogHeader><DialogTitle>{say('删除这个主题？', 'Delete this topic?')}</DialogTitle><DialogDescription>{say('主题下的任务会保留，并移到所属项目的“未分类”。', 'Tasks will be kept in the project’s Unclassified group.')}</DialogDescription></DialogHeader>{topicError && <p role="alert" className="text-sm text-destructive">{topicError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={topicSaving} onClick={() => setDeleteTopicOpen(false)}>{say('取消', 'Cancel')}</Button><Button variant="destructive" disabled={topicSaving} onClick={() => void saveTopic(true)}>{topicSaving ? say('正在删除…', 'Deleting…') : say('删除主题', 'Delete topic')}</Button></div></DialogContent></Dialog>
    <Dialog open={rename !== null} onOpenChange={open => { if (!open && !renameSaving) setRename(null) }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{say('重命名', 'Rename')}</DialogTitle><DialogDescription>{rename?.target.kind === 'topic' && rename.target.id.endsWith(`:${UNCLASSIFIED}`) ? say('将本项目全部未分类任务归入这个新主题，保留原有父子关联；不受当前筛选限制。', 'Move all unclassified tasks in this project into the new topic, preserving parent links, regardless of filters.') : say('更新名称，保留现有归属和关联。', 'Update the name while keeping existing relationships.')}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitRename}><label className="workspace-form-label">{say('新名称', 'New name')}<Input autoFocus onFocus={event => event.target.select()} required value={rename?.name || ''} maxLength={rename?.target.kind === 'task' ? 500 : rename?.target.kind === 'project' ? 180 : 120} onChange={event => setRename(previous => previous ? { ...previous, name: event.target.value } : null)} /></label>{renameError && <p role="alert" className="text-sm text-destructive">{renameError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={renameSaving} onClick={() => setRename(null)}>{say('取消', 'Cancel')}</Button><Button type="submit" disabled={renameSaving || !rename?.name.trim()}>{renameSaving ? say('正在保存…', 'Saving…') : say('保存', 'Save')}</Button></div></form></DialogContent></Dialog>
    <Dialog open={ownershipTaskId !== null} onOpenChange={open => { if (!open) setOwnershipTaskId(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{say('调整项目与主题', 'Change project & topic')}</DialogTitle><DialogDescription>{say('未单独分配项目的子任务沿用父任务展示位置。', 'A subtask without its own project follows its parent in this view.')}</DialogDescription></DialogHeader>{(() => { const task = rawTasks.find(task => task.id === ownershipTaskId), effective = tasks.find(task => task.id === ownershipTaskId); return task && <TaskInspector key={`${task.id}:${task.updatedAt}`} task={task} effectiveTask={effective} parent={tasks.find(parent => parent.id === task.parentTaskId)} onParent={() => { setOwnershipTaskId(null); select({ kind: 'task', id: task.parentTaskId! }) }} projects={projects} topics={topics} zh={zh} onFull={() => { setOwnershipTaskId(null); setFullTaskId(task.id) }} /> })()}</DialogContent></Dialog>
    {fullTaskId && <TasksPage key={fullTaskId} initialTaskId={fullTaskId} detailOnly onDetailClose={() => setFullTaskId(null)} />}
  </div>
}
