import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app-store'
import { TasksPage } from '@/components/lifeos/tasks/tasks-page'

const viewport = vi.hoisted(() => ({ mobile: false }))
const updateTask = vi.hoisted(() => vi.fn())
const fetchTaskCard = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/hooks', () => ({
  useTasks: () => ({ data: [
    { id: 'task-ui-1', title: 'Selected task', description: 'Task notes', status: 'todo', priority: 'medium', recurrence: 'weekly', recurrenceConfig: '', estimatedMinutes: 20, actualMinutes: null, tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'task-ui-2', title: 'Active task', description: '', status: 'in-progress', priority: 'high', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'task-ui-3', title: 'Done task', description: '', status: 'done', priority: 'low', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ], isLoading: false }),
  useRecurringTaskSeries: () => ({ data: { series: [{ id: 'series-ui-1', currentTaskId: 'task-ui-1', title: 'Selected task', status: 'todo', recurrence: 'weekly', dueDate: null, updatedAt: null, archived: false }], activeCount: 1, schedulerEnabled: false }, isLoading: false, isError: false, refetch: vi.fn() }),
  useProjects: () => ({ data: [] }),
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: updateTask, isPending: false }),
  useDeleteTask: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.mobile }))
vi.mock('@/components/lifeos/tasks/agent-run-panel', () => ({ AgentRunPanel: () => <div>Agent run</div> }))
vi.mock('@/components/lifeos/tasks/task-card-panel', () => ({
  TaskCardPanel: ({ taskId }: { taskId: string }) => <div>Task card {taskId}</div>,
  fetchTaskCard,
}))
vi.mock('@/components/lifeos/tasks/research-panel', () => ({
  ResearchPanel: ({ taskId }: { taskId: string }) => <div>Research {taskId}</div>,
}))

describe.each([
  { mobile: false, label: 'desktop task workspace' },
  { mobile: true, label: 'mobile task workspace' },
])('selected task detail integration: $label', ({ mobile }) => {
  it('opens the task card and research panels in the main workspace', async () => {
    updateTask.mockClear()
    fetchTaskCard.mockResolvedValue({ goal: '来自任务卡的真实目标', expectedArtifacts: ['可交付报告'], verification: ['通过验收用例'], nextStep: '复核报告' })
    useAppStore.setState({ language: 'zh' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)

    await user.click(screen.getByText('Selected task'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText('Task card task-ui-1')).toBeInTheDocument()
    expect(screen.getByText('Research task-ui-1')).toBeInTheDocument()
    expect(screen.getByRole('region')).toHaveAttribute('aria-label', '任务详情')
    expect(screen.getByText('任务目标')).toBeInTheDocument()
    expect(screen.getByText('预期产出与验收')).toBeInTheDocument()
    expect(await screen.findByText('来自任务卡的真实目标')).toBeInTheDocument()
    expect(screen.getByText('可交付报告')).toBeInTheDocument()
    expect(screen.getByText('通过验收用例')).toBeInTheDocument()
    expect(screen.getByText('复核报告')).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes('任务编号 · task-ui-1'))).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-task-id', 'task-ui-1'))
    await user.click(screen.getByText('Selected task'))
    expect(await screen.findByRole('region')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(within(screen.getByRole('region')).getByRole('button', { name: '编辑' }))
    expect(screen.getByText('任务标题')).toBeInTheDocument()
    expect(screen.queryByTestId('task-detail-extensions')).not.toBeInTheDocument()
    await user.clear(screen.getByDisplayValue('Selected task'))
    await user.type(screen.getByLabelText('任务标题'), 'Updated task')
    expect(screen.getByRole('button', { name: '返回任务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: '返回任务' }))
    expect(confirmDiscard).toHaveBeenCalledWith('放弃尚未保存的修改？')
    confirmDiscard.mockRestore()
    expect(screen.getByRole('region')).toBeInTheDocument()
    expect(updateTask).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole('region')).getByRole('button', { name: '编辑' }))
    await user.clear(screen.getByLabelText('任务标题'))
    await user.type(screen.getByLabelText('任务标题'), 'Saved task')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-ui-1', title: 'Saved task' }), expect.any(Object))
  })

  it('keeps the user in edit mode when they cancel navigation with unsaved changes', async () => {
    useAppStore.setState({ language: 'zh', activeModule: 'tasks' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)
    await user.click(screen.getByText('Selected task'))
    await user.click(within(screen.getByRole('region')).getByRole('button', { name: '编辑' }))
    await user.type(screen.getByLabelText('任务标题'), ' 修改')
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const beforeModuleChange = new CustomEvent('lifeos:before-module-change', { cancelable: true })
    window.dispatchEvent(beforeModuleChange)
    expect(confirmDiscard).toHaveBeenCalledWith('放弃尚未保存的修改？')
    expect(beforeModuleChange.defaultPrevented).toBe(true)
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    confirmDiscard.mockRestore()
  })

  it('shows recurring series once and opens its current task in the shared dialog', async () => {
    useAppStore.setState({ language: 'zh', activeModule: 'tasks' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)
    await user.click(screen.getByRole('tab', { name: /持续化任务/ }))
    expect(screen.getAllByText('自动续建已暂停').length).toBeGreaterThan(0)
    const seriesCard = screen.getAllByRole('button').find(button => button.getAttribute('data-task-id') === 'task-ui-1')!
    expect(seriesCard).toHaveAttribute('data-task-id', 'task-ui-1')
    await user.click(seriesCard)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Task card task-ui-1')).toBeInTheDocument()
  })

  it('guards unsaved edits on Escape and backdrop close, then restores focus', async () => {
    useAppStore.setState({ language: 'zh', activeModule: 'tasks' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)
    const taskTrigger = screen.getByText('Selected task')
    await user.click(taskTrigger)
    await user.click(within(screen.getByRole('region', { name: '任务详情' })).getByRole('button', { name: '编辑' }))
    await user.type(screen.getByLabelText('任务标题'), ' 修改')
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.keyboard('{Escape}')
    expect(confirmDiscard).toHaveBeenCalledWith('放弃尚未保存的修改？')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    confirmDiscard.mockReturnValue(true)
    await user.click(document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    confirmDiscard.mockRestore()
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-task-id', 'task-ui-1'))
  })

  it('prioritizes work queues while keeping detailed status filters available', async () => {
    useAppStore.setState({ language: 'zh', activeModule: 'tasks' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)

    expect(screen.getByText(content => content.replace(/\s+/g, ' ').includes('全部任务: 1 共 3 项任务已完成'))).toBeInTheDocument()
    const queue = screen.getByRole('group', { name: '任务队列' })
    expect(within(queue).getByRole('button', { name: /进行中[\s\S]*1/ })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: /待处理[\s\S]*0/ })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: /进行中/ })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: /待处理/ })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: /下一步[\s\S]*1/ })).toBeInTheDocument()
    const scrollContainer = queue.closest<HTMLElement>('.overflow-y-auto')
    if (scrollContainer) scrollContainer.scrollTop = 180
    await user.click(within(queue).getByRole('button', { name: /待处理[\s\S]*0/ }))
    expect(screen.queryByText('Selected task')).not.toBeInTheDocument()
    await user.click(within(queue).getByRole('button', { name: /下一步[\s\S]*1/ }))
    expect(within(queue).getByRole('button', { name: /下一步[\s\S]*1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Selected task')).toBeInTheDocument()
    await user.click(screen.getByText('Selected task'))
    expect(await screen.findByRole('region', { name: '任务详情' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('region', { name: '任务详情' })).getByRole('button', { name: '返回任务列表' }))
    expect(screen.getByRole('button', { name: /下一步[\s\S]*1/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Selected task')).toBeInTheDocument()
    if (scrollContainer) expect(scrollContainer.scrollTop).toBe(180)

    await user.click(screen.getByText('按状态筛选'))
    expect(screen.getByRole('button', { name: /^完成/ })).toBeInTheDocument()
  })

  it('retries loading the task card after an API error', async () => {
    useAppStore.setState({ language: 'zh', activeModule: 'tasks' })
    viewport.mobile = mobile
    fetchTaskCard.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({ goal: 'Recovered goal', expectedArtifacts: [], verification: [], nextStep: '' })
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient()}><TasksPage /></QueryClientProvider>)
    await user.click(screen.getByText('Selected task'))
    expect(await screen.findByRole('alert')).toHaveTextContent('任务目标读取失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Recovered goal')).toBeInTheDocument()
  })
})

