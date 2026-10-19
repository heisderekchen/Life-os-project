'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder, Inbox, Layers, List, LoaderCircle, Network, PanelLeftClose, Plus, Search, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTasks, useProjects, useCreateTask, useCreateProject, useUpdateTask } from '@/lib/api/hooks'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api/client'
import { useTranslation } from '@/lib/i18n'
import { useTaskStore, type Task } from '@/stores/task-store'
import { TasksPage, mapApiTask, mapApiProject } from '../tasks/tasks-page'
import { ProjectsPage } from './projects-page'
import { WorkspaceGraph } from './workspace-graph'
import { INBOX, selectedScope, taskType, workspaceGroups, type ProjectTopic, type WorkspaceProject, type WorkspaceSelection } from './workspace-model'
import './project-workspace.css'

type View = 'linked' | 'list' | 'graph'
type Status = 'all' | 'todo' | 'in-progress' | 'overdue' | 'done' | 'cancelled'
type Preferences = { view: View; search: string; status: Status; type: string; project: string; sort: 'updated' | 'name' | 'status' | 'due'; ascending: boolean; grouped: boolean; archived: boolean }
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

function TaskInspector({ task, projects, topics, zh, onFull }: { task: Task; projects: WorkspaceProject[]; topics: ProjectTopic[]; zh: boolean; onFull: () => void }) {
  const mutation = useUpdateTask()
  const [draft, setDraft] = useState({ projectId: task.projectId || '', topicId: task.topicId || '', status: task.status, taskType: taskType(task), dueDate: dateInput(task.dueDate) })
  const [error, setError] = useState('')
  const changed = draft.projectId !== (task.projectId || '') || draft.topicId !== (task.topicId || '') || draft.status !== task.status || draft.taskType !== taskType(task) || draft.dueDate !== dateInput(task.dueDate)
  const topic = topics.find(topic => topic.id === task.topicId)
  const project = projects.find(project => project.id === task.projectId)
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      await mutation.mutateAsync({ id: task.id, ...draft, projectId: draft.projectId || null, topicId: draft.topicId || null, taskType: draft.taskType.trim() || null, dueDate: draft.dueDate || null })
      toast.success(zh ? '任务已保存' : 'Task saved')
    } catch (error) { setError(error instanceof Error ? error.message : (zh ? '保存失败，请重试' : 'Could not save. Please retry.')) }
  }
  return <section className="workspace-inspector" aria-label={zh ? '任务概要' : 'Task summary'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words text-lg font-semibold">{task.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{project?.name || (zh ? '收件箱' : 'Inbox')}<span aria-hidden> › </span>{topic?.name || (zh ? '未分类' : 'Unclassified')}</p></div><Button variant="outline" size="sm" className="h-10 gap-2" onClick={onFull}>{zh ? '打开完整详情' : 'Full details'}<ExternalLink size={14} /></Button></div>
    <form onSubmit={save} className="mt-5 space-y-4">
      <div className="workspace-fields">
        <label>{zh ? '所属项目' : 'Project'}<select value={draft.projectId} onChange={event => setDraft({ ...draft, projectId: event.target.value, topicId: '' })}><option value="">{zh ? '收件箱' : 'Inbox'}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archived ? (zh ? '（已归档）' : ' (archived)') : ''}</option>)}</select></label>
        <label>{zh ? '所属主题' : 'Topic'}<select value={draft.topicId} onChange={event => setDraft({ ...draft, topicId: event.target.value })} disabled={!draft.projectId}><option value="">{zh ? '未分类' : 'Unclassified'}</option>{topics.filter(topic => topic.projectId === draft.projectId).map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>
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
  const qc = useQueryClient(), createTask = useCreateTask(), createProject = useCreateProject()
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
  const tableScroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || 'null')
      if (saved && typeof saved === 'object') {
        setPrefs({ ...defaults, ...saved.prefs, view: ['linked', 'list', 'graph'].includes(saved.prefs?.view) ? saved.prefs.view : defaults.view })
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
    try { localStorage.setItem(preferenceKey, JSON.stringify({ prefs, expanded: [...expanded] })) } catch {}
  }, [prefs, expanded, hydrated])

  const projects = useMemo(() => ((projectsQuery.data || []) as Record<string, unknown>[]).map(project => ({ ...mapApiProject(project), archived: Boolean(project.archived) })), [projectsQuery.data])
  const tasks = useMemo(() => ((tasksQuery.data || []) as Record<string, unknown>[]).map(mapApiTask).filter(task => !task.archived), [tasksQuery.data])
  const topics = useMemo(() => topicsQuery.data || [], [topicsQuery.data])
  const visibleProjects = useMemo(() => projects.filter(project => prefs.archived || !project.archived), [projects, prefs.archived])
  const allGroups = useMemo(() => workspaceGroups(projects, topics, tasks, zh ? '收件箱' : 'Inbox', zh ? '未分类' : 'Unclassified'), [projects, topics, tasks, zh])
  const scope = selectedScope(selection, allGroups, tasks)
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map(project => project.id)), [visibleProjects])
  const projectNames = useMemo(() => new Map(projects.map(project => [project.id, project.name])), [projects])
  const topicNames = useMemo(() => new Map(topics.map(topic => [topic.id, topic.name])), [topics])
  const searchable = useMemo(() => tasks.filter(task => {
    if (task.projectId && projectNames.has(task.projectId) && !visibleProjectIds.has(task.projectId)) return false
    if (prefs.project && (task.projectId || INBOX) !== prefs.project) return false
    if (prefs.type && taskType(task) !== prefs.type) return false
    const needle = prefs.search.trim().toLocaleLowerCase()
    return !needle || [task.title, task.description, task.sourceProject, taskType(task), task.projectId ? projectNames.get(task.projectId) : '', task.topicId ? topicNames.get(task.topicId) : '', ...task.tags].join(' ').toLocaleLowerCase().includes(needle)
  }), [tasks, prefs.project, prefs.type, prefs.search, visibleProjectIds, projectNames, topicNames])
  const counts = Object.fromEntries(statuses.map(status => [status, searchable.filter(task => status === 'all' || (status === 'overdue' ? overdue(task) : task.status === status)).length]))
  const filteredTasks = useMemo(() => {
    const selected = searchable.filter(task => prefs.status === 'all' || (prefs.status === 'overdue' ? overdue(task) : task.status === prefs.status))
    return selected.sort((a, b) => {
      let compared = 0
      if (prefs.sort === 'name') compared = a.title.localeCompare(b.title)
      else if (prefs.sort === 'status') compared = a.status.localeCompare(b.status)
      else if (prefs.sort === 'due') { if (!a.dueDate) return b.dueDate ? 1 : 0; if (!b.dueDate) return -1; compared = a.dueDate.localeCompare(b.dueDate) }
      else compared = a.updatedAt.localeCompare(b.updatedAt)
      return (prefs.ascending ? compared : -compared) || a.id.localeCompare(b.id)
    })
  }, [searchable, prefs.status, prefs.sort, prefs.ascending])
  const filtering = Boolean(prefs.search.trim() || prefs.type || prefs.status !== 'all')
  const graphGroups = useMemo(() => workspaceGroups(visibleProjects.filter(project => !prefs.project || project.id === prefs.project), topics, filteredTasks, zh ? '收件箱' : 'Inbox', zh ? '未分类' : 'Unclassified')
    .filter(group => (!prefs.project || group.id === prefs.project) && (!filtering || group.tasks.length > 0 || Boolean(prefs.search.trim()) && [group.name, ...group.topics.map(topic => topic.name)].some(name => name.toLocaleLowerCase().includes(prefs.search.trim().toLocaleLowerCase())))), [visibleProjects, topics, filteredTasks, prefs.project, filtering, prefs.search, zh])
  const tableGroups = graphGroups.filter(group => !scope || group.id === scope.projectId).map(group => ({ ...group, topics: group.topics.filter(topic => !scope?.topicId || topic.id === scope.topicId) }))
  const scopedTasks = filteredTasks.filter(task => !scope || tableGroups.some(group => group.topics.some(topic => topic.tasks.some(item => item.id === task.id))))
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
    setExpanded(new Set([`project:${first.id}`, ...(first.topics[0] && first.topics[0].tasks.length <= 8 ? [`topic:${first.topics[0].id}`] : [])]))
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
    if (!next) return
    const target = selectedScope(next, allGroups, tasks)
    if (target) setExpanded(previous => new Set([...previous, `project:${target.projectId}`, ...(target.topicId ? [`topic:${target.topicId}`] : [])]))
  }, [allGroups, tasks])
  const selectGraph = useCallback((next: WorkspaceSelection) => { select(next); if (prefs.view === 'graph' && next?.kind === 'task') setFullTaskId(next.id) }, [select, prefs.view])
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setPrefs(previous => ({ ...previous, [key]: value })); setPage(0); if (['search', 'status', 'type', 'project'].includes(key)) setExpanded(new Set(allGroups.flatMap(group => [`project:${group.id}`, ...group.topics.map(topic => `topic:${topic.id}`)]))) }
  const reset = () => { setPrefs(previous => ({ ...defaults, view: previous.view })); setSelection(null); setPage(0) }
  const openCreate = (kind: 'task' | 'topic' | 'project') => {
    setTitle(''); setNewType(''); setNewDue(''); setFormError('')
    setNewProject(selectedProject?.id || (prefs.project !== INBOX ? prefs.project : '') || '')
    setNewTopic(selectedTopic?.id || selectedTask?.topicId || '')
    setCreateKind(kind)
  }
  const refreshTopics = () => qc.invalidateQueries({ queryKey: ['project-topics'] })
  const submitCreate = async (event: FormEvent) => {
    event.preventDefault(); if (!title.trim()) return; setSaving(true); setFormError('')
    try {
      if (createKind === 'task') {
        const created = await createTask.mutateAsync({ title: title.trim(), projectId: newProject || null, topicId: newTopic || null, taskType: newType.trim() || null, dueDate: newDue || null, status: 'todo', priority: 'medium' }) as { id: string }
        setPrefs(previous => ({ ...previous, search: '', project: '', type: '', status: 'all' })); select({ kind: 'task', id: created.id })
        setExpanded(previous => new Set([...previous, `project:${newProject || INBOX}`, `topic:${newProject || INBOX}:${newTopic || '__unclassified__'}`]))
      } else if (createKind === 'topic') {
        const created = await apiPost<ProjectTopic>('/api/topics', { name: title.trim(), projectId: newProject }); await refreshTopics()
        select({ kind: 'topic', id: `${created.projectId}:${created.id}` }); setExpanded(previous => new Set([...previous, `project:${created.projectId}`, `topic:${created.projectId}:${created.id}`]))
        setPrefs(previous => ({ ...previous, search: '', project: '', type: '', status: 'all' }))
      } else {
        const created = await createProject.mutateAsync({ name: title.trim(), color: '#0f766e', status: 'active' }) as { id: string }
        select({ kind: 'project', id: created.id }); setPrefs(previous => ({ ...previous, search: '', project: '', type: '', status: 'all' }))
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

  if (utility) return <div className="flex h-full min-h-0 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-4 py-2"><Button variant="ghost" className="gap-2" onClick={() => setUtility(null)}><ChevronRight size={16} className="rotate-180" />{say('返回项目与任务', 'Back to projects & tasks')}</Button><span className="text-sm text-muted-foreground">{utility === 'execution' ? say('周期与任务执行', 'Recurring tasks & execution') : say('项目管理', 'Project management')}</span></div><div className="min-h-0 flex-1 overflow-auto">{utility === 'projects' ? <ProjectsPage /> : <TasksPage />}</div></div>
  const taskRow = (task: Task, nested = false) => <tr key={task.id} data-workspace-task={task.id} className={selectedTask?.id === task.id ? 'is-selected' : ''} aria-selected={selectedTask?.id === task.id}>
    <td><button type="button" className={`workspace-row-name ${nested ? 'is-nested' : ''}`} onClick={() => select({ kind: 'task', id: task.id })}><FileText size={17} aria-hidden /><span className="min-w-0"><span className="workspace-task-title" title={task.title}>{task.parentTaskId && <span className="mr-1 text-muted-foreground" aria-label={say('子任务', 'Subtask')}>↳</span>}{task.title}</span>{!prefs.grouped && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{projectNames.get(task.projectId || '') || say('收件箱', 'Inbox')} / {topicNames.get(task.topicId || '') || say('未分类', 'Unclassified')}</span>}</span></button></td>
    <td><span className="workspace-type">{taskType(task) || '—'}</span></td><td><span className={`workspace-status status-${task.status}`}>{labels[task.status] || task.status}</span>{overdue(task) && <span className="ml-1 text-xs text-destructive">{say('逾期', 'Overdue')}</span>}</td><td><time title={task.updatedAt} dateTime={task.updatedAt}>{dateLabel(task.updatedAt, zh)}</time></td><td><time dateTime={task.dueDate || undefined} className={overdue(task) ? 'text-destructive' : ''}>{dateInput(task.dueDate) || '—'}</time></td>
  </tr>
  const graphExpanded = expanded
  const rows: React.ReactNode[] = []
  if (prefs.grouped) {
    for (const group of tableGroups) {
      const projectNode = `project:${group.id}`, opened = expanded.has(projectNode)
      rows.push(<tr key={projectNode} className="workspace-group"><td><div className="flex items-center"><button type="button" className="workspace-collapse" aria-label={`${say('展开或收起项目', 'Expand or collapse project')} ${group.name}`} aria-expanded={opened} onClick={() => toggleExpanded(projectNode)}>{opened ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="workspace-row-name" onClick={() => select({ kind: 'project', id: group.id })}><Folder size={18} /><span className="truncate font-semibold" title={group.name}>{group.name}</span><span className="text-xs text-muted-foreground">{group.tasks.length}</span></button></div></td><td>{say('项目', 'Project')}</td><td>{group.project?.status ? ({ active: say('进行中', 'Active'), 'on-hold': say('暂停', 'On hold'), completed: say('已完成', 'Completed'), cancelled: say('已取消', 'Cancelled') }[group.project.status] || group.project.status) : '—'}</td><td>{dateLabel(group.project?.updatedAt, zh)}</td><td>{dateInput(group.project?.endDate || null) || '—'}</td></tr>)
      if (!opened) continue
      for (const topic of group.topics) {
        const topicNode = `topic:${topic.id}`, topicOpen = expanded.has(topicNode)
        rows.push(<tr key={topicNode} className="workspace-topic"><td><div className="flex items-center pl-5"><button type="button" className="workspace-collapse" aria-label={`${say('展开或收起主题', 'Expand or collapse topic')} ${topic.name}`} aria-expanded={topicOpen} onClick={() => toggleExpanded(topicNode)}>{topicOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button className="workspace-row-name" onClick={() => select({ kind: 'topic', id: topic.id })}><Layers size={17} /><span className="truncate" title={topic.name}>{topic.name}</span><span className="text-xs text-muted-foreground">{topic.tasks.length}</span></button></div></td><td>{say('主题', 'Topic')}</td><td>—</td><td>{dateLabel(topic.topic?.updatedAt, zh)}</td><td>—</td></tr>)
        if (topicOpen) rows.push(...topic.tasks.map(task => taskRow(task, true)))
      }
    }
  } else rows.push(...scopedTasks.map(task => taskRow(task)))
  const pageSize = Math.max(80, rows.length), pages = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pages - 1)

  return <div className="project-workspace" data-testid="project-workspace">
    <header className="workspace-header"><div><h1>{say('项目与任务', 'Projects & tasks')}</h1><p>{say('用关系图梳理结构，用列表推进任务', 'Map the structure. Move the work forward.')}</p></div><div className="flex flex-wrap items-center gap-2"><div className="workspace-view-switch" role="group" aria-label={say('视图', 'Workspace view')}>{([{ id: 'linked', label: say('联动', 'Linked'), icon: PanelLeftClose }, { id: 'list', label: say('列表', 'List'), icon: List }, { id: 'graph', label: say('关系图', 'Graph'), icon: Network }] as const).map(view => <button key={view.id} aria-pressed={prefs.view === view.id} onClick={() => change('view', view.id)}><view.icon size={15} /><span>{view.label}</span></button>)}</div><Button className="h-10 gap-1.5" onClick={() => openCreate('task')}><Plus size={16} />{say('新建', 'New')}</Button><details className="workspace-mobile-more"><summary aria-label={say('更多操作', 'More actions')}><Settings2 size={17} /></summary><div><button onClick={() => openCreate('project')}>{say('新建项目', 'New project')}</button><button onClick={() => openCreate('topic')}>{say('新建主题', 'New topic')}</button><button onClick={() => setUtility('projects')}>{say('管理项目', 'Manage projects')}</button><button onClick={() => setUtility('execution')}>{say('周期与执行', 'Recurring & execution')}</button></div></details></div></header>
    <div className="workspace-toolbar"><div className="workspace-search"><Search size={17} /><Input aria-label={say('搜索项目、主题或任务', 'Search projects, topics or tasks')} placeholder={say('搜索项目、主题或任务', 'Search projects, topics or tasks')} value={prefs.search} onChange={event => { change('search', event.target.value); setSelection(null) }} />{prefs.search && <button aria-label={say('清除搜索', 'Clear search')} onClick={() => change('search', '')}><X size={15} /></button>}</div>
      <select aria-label={say('项目筛选', 'Project filter')} value={prefs.project} onChange={event => { change('project', event.target.value); setSelection(null) }}><option value="">{say('全部项目', 'All projects')}</option><option value={INBOX}>{say('收件箱', 'Inbox')}</option>{visibleProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label={say('类型筛选', 'Type filter')} value={prefs.type} onChange={event => { change('type', event.target.value); setSelection(null) }}><option value="">{say('全部类型', 'All types')}</option>{typeOptions.map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label={say('排序字段', 'Sort by')} value={prefs.sort} onChange={event => change('sort', event.target.value as Preferences['sort'])}><option value="updated">{say('最近更新', 'Last updated')}</option><option value="name">{say('名称', 'Name')}</option><option value="status">{say('状态', 'Status')}</option><option value="due">{say('截止日期', 'Due date')}</option></select><button className="workspace-sort" aria-label={prefs.ascending ? say('切换为降序', 'Sort descending') : say('切换为升序', 'Sort ascending')} onClick={() => change('ascending', !prefs.ascending)}>{prefs.ascending ? '↑' : '↓'}</button>
    </div>
    <div className="workspace-filter-bar"><div role="group" aria-label={say('任务筛选', 'Task filters')} className="workspace-status-filters">{statuses.map(status => <button key={status} aria-pressed={prefs.status === status} onClick={() => { change('status', status); setSelection(null) }}>{labels[status]} <span>{counts[status] || 0}</span></button>)}</div><div className="workspace-tools"><button onClick={() => openCreate('project')}><Plus size={14} />{say('项目', 'Project')}</button><button onClick={() => openCreate('topic')}><Plus size={14} />{say('主题', 'Topic')}</button><button title={say('管理项目', 'Manage projects')} aria-label={say('管理项目', 'Manage projects')} onClick={() => setUtility('projects')}><Settings2 size={16} /></button><button onClick={() => setUtility('execution')}>{say('周期与执行', 'Recurring & execution')}<ExternalLink size={13} /></button></div></div>
    {loading ? <div className="workspace-message" role="status"><LoaderCircle className="animate-spin" size={24} />{say('正在读取项目与任务…', 'Loading projects and tasks…')}</div> : failed ? <div className="workspace-message" role="alert"><p>{say('项目或任务读取失败，请重试。', 'Could not load projects or tasks. Please retry.')}</p><Button variant="outline" onClick={() => { void tasksQuery.refetch(); void projectsQuery.refetch(); void topicsQuery.refetch() }}>{say('重试', 'Retry')}</Button></div> : <div className={`workspace-body view-${prefs.view}`}>
      {prefs.view !== 'list' && <section className="workspace-map" aria-label={say('关系图', 'Relationship graph')}><div className="workspace-pane-heading"><div><h2>{say('关系图', 'Relationship graph')}</h2><p>{say('项目 → 主题 → 任务', 'Project → Topic → Task')}</p></div><Button variant="ghost" size="sm" onClick={() => { setExpanded(new Set()); setSelection(null) }}>{say('收起全部', 'Collapse all')}</Button></div><div className="workspace-canvas">{graphGroups.length ? <WorkspaceGraph groups={graphGroups} selection={selection} expanded={graphExpanded} onExpand={toggleExpanded} onSelect={selectGraph} zh={zh} /> : <div className="workspace-message"><Inbox size={30} /><p>{say('没有匹配的项目或任务', 'No matching projects or tasks')}</p><Button variant="outline" onClick={reset}>{say('清除筛选', 'Clear filters')}</Button></div>}</div><p className="workspace-map-hint">{say('点击节点联动列表 · 展开箭头查看下一级', 'Select a node to sync the list · Expand to see its children')}</p></section>}
      {prefs.view !== 'graph' && <section className="workspace-list" aria-label={say('任务列表', 'Task list')}><div className="workspace-pane-heading"><div className="min-w-0"><h2 className="truncate">{selectedProject?.name || (scope?.projectId === INBOX ? say('收件箱', 'Inbox') : say('全部项目', 'All projects'))}{scope?.topicId && <span className="text-sm font-normal"> / {selectedTopic?.name || (selectedTask?.topicId ? topicNames.get(selectedTask.topicId) : null) || say('未分类', 'Unclassified')}</span>}</h2><p aria-live="polite">{scopedTasks.length} {say('项任务', 'tasks')}{filtering ? say(' · 已筛选', ' · filtered') : ''}</p></div><div className="flex shrink-0 items-center gap-2">{selection && <button className="workspace-text-button" onClick={() => select(null)}>{say('查看全部', 'View all')}</button>}<button className="workspace-text-button" onClick={() => change('grouped', !prefs.grouped)}>{prefs.grouped ? say('平铺', 'Flat list') : say('按层级', 'Hierarchy')}</button></div></div>
        <div className="workspace-table-scroll" ref={tableScroll}><table className="workspace-table"><caption className="sr-only">{say('项目、主题、任务与类型、状态、更新日期及截止日期', 'Projects, topics and tasks with type, status, updated and due dates')}</caption><thead><tr><th scope="col">{say('名称', 'Name')}</th><th scope="col">{say('类型', 'Type')}</th><th scope="col">{say('状态', 'Status')}</th><th scope="col">{say('更新日期', 'Updated')}</th><th scope="col">{say('截止日期', 'Due date')}</th></tr></thead><tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}</tbody></table>{!rows.length && <div className="workspace-message"><FileText size={28} /><p>{say('没有匹配的项目或任务', 'No matching projects or tasks')}</p><Button variant="outline" onClick={reset}>{say('清除筛选', 'Clear filters')}</Button></div>}</div>
        {pages > 1 && <div className="workspace-pagination"><Button variant="ghost" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{say('上一页', 'Previous')}</Button><span>{currentPage + 1} / {pages}</span><Button variant="ghost" size="sm" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>{say('下一页', 'Next')}</Button></div>}
        {selectedTask ? <TaskInspector key={`${selectedTask.id}:${selectedTask.updatedAt}`} task={selectedTask} projects={projects} topics={topics} zh={zh} onFull={() => setFullTaskId(selectedTask.id)} /> : selectedTopic ? <section className="workspace-inspector"><h3 className="text-lg font-semibold">{selectedTopic.name}</h3><p className="mt-1 text-xs text-muted-foreground">{selectedProject?.name} / {say('主题', 'Topic')}</p><form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void saveTopic() }}><Input aria-label={say('主题名称', 'Topic name')} value={topicName} maxLength={120} onChange={event => setTopicName(event.target.value)} className="min-w-0 flex-1" /><Button type="submit" disabled={topicSaving || !topicName.trim() || topicName.trim() === selectedTopic.name}>{say('保存', 'Save')}</Button><Button type="button" variant="ghost" className="text-destructive" disabled={topicSaving} onClick={() => setDeleteTopicOpen(true)}>{say('删除主题', 'Delete topic')}</Button></form>{topicError && <p role="alert" className="mt-2 text-sm text-destructive">{topicError}</p>}</section> : <section className="workspace-inspector workspace-idle"><Layers size={22} /><div><p className="font-medium">{selectedProject?.name || say('从结构到行动', 'From structure to action')}</p><p className="mt-1 text-sm text-muted-foreground">{say('选择任务查看详情，或为项目新建主题。', 'Select a task to see details, or add a topic to a project.')}</p></div>{selectedProject && <Button variant="outline" size="sm" onClick={() => openCreate('topic')}>{say('新建主题', 'New topic')}</Button>}</section>}
      </section>}
    </div>}
    <footer className="workspace-footer"><span>{say('图和列表共享数据，筛选与选中状态同步', 'Shared data, filters and selection across both views')}</span><label><input type="checkbox" checked={prefs.archived} onChange={event => { change('archived', event.target.checked); setSelection(null) }} />{say('显示归档项目', 'Show archived projects')}</label>{filtering && <button onClick={reset}>{say('清除筛选', 'Clear filters')}</button>}</footer>
    <Dialog open={createKind !== null} onOpenChange={open => { if (!open && !saving) setCreateKind(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{createKind === 'task' ? say('新建任务', 'New task') : createKind === 'topic' ? say('新建主题', 'New topic') : say('新建项目', 'New project')}</DialogTitle><DialogDescription>{createKind === 'topic' ? say('主题属于一个项目，用来归集相关任务。', 'A topic belongs to one project and groups related tasks.') : say('保存后可继续补充详情。', 'You can add more detail after saving.')}</DialogDescription></DialogHeader><form onSubmit={submitCreate} className="space-y-4"><label className="workspace-form-label">{say('名称', 'Name')}<Input autoFocus required value={title} maxLength={createKind === 'topic' ? 120 : createKind === 'project' ? 180 : 500} onChange={event => setTitle(event.target.value)} /></label>{createKind !== 'project' && <div className="workspace-fields"><label>{say('所属项目', 'Project')}<select required={createKind === 'topic'} value={newProject} onChange={event => { setNewProject(event.target.value); setNewTopic('') }}><option value="">{createKind === 'topic' ? say('选择项目', 'Select a project') : say('收件箱', 'Inbox')}</option>{visibleProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>{createKind === 'task' && <><label>{say('所属主题', 'Topic')}<select value={newTopic} disabled={!newProject} onChange={event => setNewTopic(event.target.value)}><option value="">{say('未分类', 'Unclassified')}</option>{topics.filter(topic => topic.projectId === newProject).map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><label>{say('类型', 'Type')}<input maxLength={60} value={newType} placeholder={say('需求、缺陷、研究…', 'Requirement, bug, research…')} onChange={event => setNewType(event.target.value)} /></label><label>{say('截止日期', 'Due date')}<input type="date" value={newDue} onChange={event => setNewDue(event.target.value)} /></label></>}</div>}{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setCreateKind(null)}>{say('取消', 'Cancel')}</Button><Button type="submit" disabled={saving || !title.trim()}>{saving ? say('正在保存…', 'Saving…') : say('创建', 'Create')}</Button></div></form></DialogContent></Dialog>
    <Dialog open={deleteTopicOpen} onOpenChange={open => { if (!topicSaving) setDeleteTopicOpen(open) }}><DialogContent><DialogHeader><DialogTitle>{say('删除这个主题？', 'Delete this topic?')}</DialogTitle><DialogDescription>{say('主题下的任务会保留，并移到所属项目的“未分类”。', 'Tasks will be kept in the project’s Unclassified group.')}</DialogDescription></DialogHeader>{topicError && <p role="alert" className="text-sm text-destructive">{topicError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={topicSaving} onClick={() => setDeleteTopicOpen(false)}>{say('取消', 'Cancel')}</Button><Button variant="destructive" disabled={topicSaving} onClick={() => void saveTopic(true)}>{topicSaving ? say('正在删除…', 'Deleting…') : say('删除主题', 'Delete topic')}</Button></div></DialogContent></Dialog>
    {fullTaskId && <TasksPage key={fullTaskId} initialTaskId={fullTaskId} detailOnly onDetailClose={() => setFullTaskId(null)} />}
  </div>
}
