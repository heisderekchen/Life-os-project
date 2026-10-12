import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from '@/stores/app-store'
import { TasksPage } from '@/components/lifeos/tasks/tasks-page'

const viewport = vi.hoisted(() => ({ mobile: false }))
const updateTask = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/hooks', () => ({
  useTasks: () => ({ data: [{ id: 'task-ui-1', title: 'Selected task', description: 'Task notes', status: 'todo', priority: 'medium', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], isLoading: false }),
  useProjects: () => ({ data: [] }),
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: updateTask, isPending: false }),
  useDeleteTask: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.mobile }))
vi.mock('@/components/lifeos/tasks/agent-run-panel', () => ({ AgentRunPanel: () => <div>Agent run</div> }))
vi.mock('@/components/lifeos/tasks/task-card-panel', () => ({
  TaskCardPanel: ({ taskId }: { taskId: string }) => <div>Task card {taskId}</div>,
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
    useAppStore.setState({ language: 'zh' })
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)

    await user.click(screen.getByText('Selected task'))

    expect(await screen.findByText('Task card task-ui-1')).toBeInTheDocument()
    expect(screen.getByText('Research task-ui-1')).toBeInTheDocument()
    expect(screen.getByRole('region')).toHaveAttribute('aria-label', '任务详情')

    await user.click(within(screen.getByRole('region')).getByRole('button', { name: '编辑' }))
    expect(screen.getByText('任务标题')).toBeInTheDocument()
    expect(screen.queryByTestId('task-detail-extensions')).not.toBeInTheDocument()
    await user.clear(screen.getByDisplayValue('Selected task'))
    await user.type(screen.getByLabelText('任务标题'), 'Updated task')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('region')).toBeInTheDocument()
    expect(updateTask).not.toHaveBeenCalled()

    await user.click(within(screen.getByRole('region')).getByRole('button', { name: '编辑' }))
    await user.clear(screen.getByLabelText('任务标题'))
    await user.type(screen.getByLabelText('任务标题'), 'Saved task')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-ui-1', title: 'Saved task' }), expect.any(Object))
  })
})
