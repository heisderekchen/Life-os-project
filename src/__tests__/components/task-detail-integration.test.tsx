import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPage } from '@/components/lifeos/tasks/tasks-page'

const viewport = vi.hoisted(() => ({ mobile: false }))

vi.mock('@/lib/api/hooks', () => ({
  useTasks: () => ({ data: [{ id: 'task-ui-1', title: 'Selected task', description: 'Task notes', status: 'todo', priority: 'medium', tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], isLoading: false }),
  useProjects: () => ({ data: [] }),
  useCreateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
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
  { mobile: false, label: 'desktop task detail panel' },
  { mobile: true, label: 'mobile task detail sheet' },
])('selected task detail integration: $label', ({ mobile }) => {
  it('opens the task card and research panels for the selected task', async () => {
    viewport.mobile = mobile
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    render(<QueryClientProvider client={queryClient}><TasksPage /></QueryClientProvider>)

    await user.click(screen.getByText('Selected task'))

    expect(await screen.findByText('Task card task-ui-1')).toBeInTheDocument()
    expect(screen.getByText('Research task-ui-1')).toBeInTheDocument()
  })
})
