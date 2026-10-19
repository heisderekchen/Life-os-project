import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
function setup(failPatch = false, failTopics = false) {
  let tasks = [fixture, { ...fixture, id: 'task-b', title: '其他任务', projectId: 'project-b', topicId: null, status: 'done', taskType: '研究' }]
  let patch: Record<string, unknown> | null = null
  server.use(http.get('*/api/projects', () => HttpResponse.json([project('project-a', '项目 A'), project('project-b', '项目 B')])), http.get('*/api/topics', () => failTopics ? HttpResponse.json({ error: 'Unavailable' }, { status: 503 }) : HttpResponse.json([topic])), http.get('*/api/tasks', () => HttpResponse.json(tasks)), http.patch('*/api/tasks/:id', async ({ request, params }) => {
    patch = await request.json() as Record<string, unknown>
    if (failPatch) return HttpResponse.json({ error: '保存失败测试' }, { status: 503 })
    tasks = tasks.map(task => task.id === params.id ? { ...task, ...patch } as typeof fixture : task)
    return HttpResponse.json(tasks.find(task => task.id === params.id))
  }))
  useAppStore.setState({ language: 'zh' })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ProjectWorkspace /></QueryClientProvider>)
  return { patch: () => patch }
}
beforeAll(() => Object.defineProperty(Element.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true }))
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
})
