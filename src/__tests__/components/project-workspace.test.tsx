import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { useAppStore } from '@/stores/app-store'
import { ProjectWorkspace } from '@/components/lifeos/projects/project-workspace'
import type { WorkspaceGroup, WorkspaceSelection } from '@/components/lifeos/projects/workspace-model'
vi.mock('@/components/lifeos/projects/workspace-graph', () => ({ WorkspaceGraph: ({ groups, onSelect }: { groups: WorkspaceGroup[]; onSelect: (s: WorkspaceSelection) => void }) => <div aria-label="测试关系图">{groups.flatMap(group => group.topics.flatMap(topic => [<button key={topic.id} onClick={() => onSelect({ kind: 'topic', id: topic.id })}>图主题 {topic.name}</button>, ...topic.tasks.map(task => <button key={task.id} onClick={() => onSelect({ kind: 'task', id: task.id })}>图任务 {task.title}</button>)]))}</div> }))
const timestamp = '2026-10-19T01:00:00Z'
const project = (id: string, name: string) => ({ id, name, status: 'active', color: '#0f766e', archived: false, createdAt: timestamp, updatedAt: timestamp })
const topic = { id: 'topic-a', projectId: 'project-a', name: '主题 A', createdAt: timestamp, updatedAt: timestamp }
const fixture = { id: 'task-a', title: '联动任务', status: 'todo', priority: 'medium', projectId: 'project-a', topicId: topic.id, taskType: '需求', createdAt: timestamp, updatedAt: timestamp }
function setup(failPatch = false, failTopics = false, initialTasks?: Record<string, unknown>[]) {
  let tasks: Record<string, unknown>[] = initialTasks || [fixture, { ...fixture, id: 'task-b', title: '其他任务', projectId: 'project-b', topicId: null, status: 'done', taskType: '研究' }]
  let patch: Record<string, unknown> | null = null
  let created: Record<string, unknown> | null = null
  server.use(http.get('*/api/projects', () => HttpResponse.json([project('project-a', '项目 A'), project('project-b', '项目 B')])), http.get('*/api/topics', () => failTopics ? HttpResponse.json({ error: 'Unavailable' }, { status: 503 }) : HttpResponse.json([topic])), http.get('*/api/tasks', () => HttpResponse.json(tasks)), http.post('*/api/tasks', async ({ request }) => { created = await request.json() as Record<string, unknown>; const task = { ...fixture, ...created, id: 'new-task' }; tasks.push(task); return HttpResponse.json(task, { status: 201 }) }), http.patch('*/api/tasks/:id', async ({ request, params }) => {
    patch = await request.json() as Record<string, unknown>
    if (failPatch) return HttpResponse.json({ error: '保存失败测试' }, { status: 503 })
    tasks = tasks.map(task => task.id === params.id ? { ...task, ...patch } as typeof fixture : task)
    return HttpResponse.json(tasks.find(task => task.id === params.id))
  }))
  useAppStore.setState({ language: 'zh' })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ProjectWorkspace /></QueryClientProvider>)
  return { patch: () => patch, created: () => created }
}
beforeAll(() => Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true }))
beforeEach(() => localStorage.clear())
afterEach(() => cleanup())
describe('project workspace', () => {
  it('uses a topic selection to scope the list and preserves filters between view modes', async () => {
    setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '图主题 主题 A' }))
    const list = screen.getByRole('region', { name: '任务列表' })
    expect(within(list).getByRole('button', { name: '联动任务' })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: '其他任务' })).not.toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: '查看全部' }))
    fireEvent.change(screen.getByRole('combobox', { name: '类型筛选' }), { target: { value: '研究' } })
    const graph = screen.getByLabelText('测试关系图')
    expect(within(graph).queryByRole('button', { name: '图任务 联动任务' })).not.toBeInTheDocument()
    expect(within(graph).getByRole('button', { name: '图任务 其他任务' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^列表$/ }))
    expect(screen.getByRole('combobox', { name: '类型筛选' })).toHaveValue('研究')
  })
  it('clears an incompatible topic when a task moves project and saves explicit type and status', async () => {
    const api = setup(); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '图任务 联动任务' }))
    const inspector = screen.getByRole('region', { name: '任务概要' })
    fireEvent.change(within(inspector).getByLabelText('所属项目'), { target: { value: 'project-b' } })
    expect(within(inspector).getByLabelText('所属主题')).toHaveValue('')
    fireEvent.change(within(inspector).getByLabelText('状态'), { target: { value: 'in-progress' } })
    await user.click(within(inspector).getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(api.patch()).toMatchObject({ projectId: 'project-b', topicId: null, status: 'in-progress', taskType: '需求' }))
  })
  it('keeps the unsaved draft and displays a recovery message on API failure', async () => {
    setup(true); const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '图任务 联动任务' }))
    const inspector = screen.getByRole('region', { name: '任务概要' })
    fireEvent.change(within(inspector).getByLabelText('类型'), { target: { value: '缺陷' } })
    await user.click(within(inspector).getByRole('button', { name: '保存修改' }))
    expect(await within(inspector).findByRole('alert')).toHaveTextContent('保存失败测试')
    expect(within(inspector).getByLabelText('类型')).toHaveValue('缺陷')
  })
  it('shows a retry instead of an empty workspace when topics cannot load', async () => {
    setup(false, true)
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
  it('sorts flat rows from their headers and exposes direction to assistive technology', async () => {
    setup(false, false, [{ ...fixture, title: 'B task', taskType: 'Bug' }, { ...fixture, id: 'task-b', title: 'A task', taskType: 'Analysis' }]); const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: '任务列表' })
    await user.click(within(list).getByRole('button', { name: '平铺' }))
    const table = within(list).getByRole('table')
    await user.click(within(table).getByRole('button', { name: '名称' }))
    expect(table.querySelector('[data-workspace-task]')).toHaveAttribute('data-workspace-task', 'task-b')
    expect(within(table).getByRole('columnheader', { name: '名称' })).toHaveAttribute('aria-sort', 'ascending')
    await user.click(within(table).getByRole('button', { name: '名称' }))
    expect(table.querySelector('[data-workspace-task]')).toHaveAttribute('data-workspace-task', 'task-a')
    expect(within(table).getByRole('columnheader', { name: '名称' })).toHaveAttribute('aria-sort', 'descending')
    await user.click(within(table).getByRole('button', { name: '类型' }))
    expect(table.querySelector('[data-workspace-task]')).toHaveAttribute('data-workspace-task', 'task-b')
    expect(screen.getByRole('combobox', { name: '排序字段' })).toHaveValue('type')
  })
  it('shows children under their parent and keeps real unassigned tasks separate', async () => {
    setup(false, false, [fixture, { ...fixture, id: 'child', title: '真正的子任务', projectId: null, topicId: null, parentTaskId: fixture.id }, { ...fixture, id: 'unassigned', title: '独立任务', projectId: null, topicId: null }]); const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: '任务列表' })
    const row = list.querySelector('[data-workspace-task="child"]')!
    expect(row).toHaveTextContent('父任务：联动任务')
    expect(list.querySelectorAll('[data-workspace-task]')).toHaveLength(2)
    await user.click(within(row as HTMLElement).getByRole('button', { name: /^真正的子任务/ }))
    const inspector = screen.getByRole('region', { name: '任务概要' })
    expect(inspector).toHaveTextContent('项目 A')
    expect(within(inspector).getByRole('button', { name: '联动任务' })).toBeInTheDocument()
    expect(within(inspector).getByLabelText('所属项目')).toHaveValue('')
  })
  it('renames from a right-click menu without rewriting a child’s inherited ownership', async () => {
    const api = setup(false, false, [fixture, { ...fixture, id: 'child', title: '子任务', projectId: null, topicId: null, parentTaskId: fixture.id }]); const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: '任务列表' })
    fireEvent.contextMenu(list.querySelector('[data-workspace-task="child"]')!, { clientX: 100, clientY: 100 })
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }))
    const dialog = screen.getByRole('dialog', { name: '重命名' })
    await user.clear(within(dialog).getByLabelText('新名称')); await user.type(within(dialog).getByLabelText('新名称'), '重命名的子任务')
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(api.patch()).toEqual({ title: '重命名的子任务' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('creates a subtask through the same actions without losing the parent ID', async () => {
    const api = setup(); const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: '任务列表' })
    await user.click(within(list).getByRole('button', { name: '快捷操作 联动任务' }))
    await user.click(await screen.findByRole('menuitem', { name: '新建子任务' }))
    const dialog = screen.getByRole('dialog', { name: '新建子任务' })
    expect(dialog).toHaveTextContent('父任务：联动任务')
    await user.type(within(dialog).getByLabelText('名称'), '关联的新子任务')
    await user.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() => expect(api.created()).toMatchObject({ parentTaskId: fixture.id, projectId: 'project-a', topicId: topic.id }))
  })

  it('renames the unclassified hierarchy into a persisted topic independently of search filters', async () => {
    const records: Record<string, unknown>[] = [{ ...fixture, title: '可见任务', topicId: null }, { ...fixture, id: 'hidden', title: '筛选外任务', topicId: null }]
    setup(false, false, records)
    let created: Record<string, unknown> | null = null
    const topics = [topic]
    server.use(http.get('*/api/topics', () => HttpResponse.json(topics)), http.post('*/api/topics', async ({ request }) => {
      created = await request.json() as Record<string, unknown>
      const saved = { ...topic, id: 'renamed-group', name: String(created.name) }
      topics.push(saved); records.forEach(task => { task.topicId = saved.id })
      return HttpResponse.json({ ...saved, movedTaskCount: records.length, skippedTaskCount: 0 }, { status: 201 })
    }))
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: '任务列表' })
    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目、主题或任务' }), { target: { value: '可见任务' } })
    await user.click(within(list).getByRole('button', { name: '快捷操作 未分类' }))
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }))
    const dialog = screen.getByRole('dialog', { name: '重命名' })
    expect(dialog).toHaveTextContent('不受当前筛选限制')
    fireEvent.change(within(dialog).getByLabelText('新名称'), { target: { value: '预约流程' } })
    await user.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(created).toEqual({ name: '预约流程', projectId: 'project-a', fromUnclassified: true }))
    await waitFor(() => expect(within(list).getByRole('heading', { level: 2 })).toHaveTextContent('预约流程'))
    expect(within(list).getByRole('button', { name: '筛选外任务' })).toBeInTheDocument()
  })

})
