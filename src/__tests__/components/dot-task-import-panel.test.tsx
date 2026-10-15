import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DotTaskImportPanel } from '@/components/lifeos/settings/dot-task-import-panel'
import { useAppStore } from '@/stores/app-store'

vi.mock('@/lib/api/hooks', () => ({
  useProfile: () => ({ data: { name: 'Test Owner', email: 'owner@example.test' } }),
}))

const exportFile = {
  title: 'Dot tasks',
  as_of: '2026-10-15',
  tasks: [{ name: 'New task', status: 'todo' }],
}

const preview = {
  sourceKey: 'dot.tasks',
  summary: { total: 2, willCreate: 1, alreadyImported: 0, previouslyDeleted: 0, needsReview: 1 },
  items: [
    { sourceId: 'dot-1', title: 'New task', action: 'create' },
    { sourceId: 'dot-2', title: 'Existing task', action: 'needs_review' },
  ],
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><DotTaskImportPanel /></QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => useAppStore.setState({ language: 'en' }))

describe('DotTaskImportPanel', () => {
  it('previews collisions before confirming only new tasks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1 }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPanel()

    const file = new File([JSON.stringify(exportFile)], 'dot-export.json', { type: 'application/json' })
    await user.upload(screen.getByLabelText('Choose Dot JSON'), file)

    expect(await screen.findByText('Existing task')).toBeInTheDocument()
    expect(screen.getByText('New tasks')).toBeInTheDocument()
    expect(screen.getByText('Test Owner · owner@example.test')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tasks/import/preview')

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Import new tasks' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe('/api/tasks/import')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ ...exportFile, confirm: true })
    expect(await screen.findByRole('status')).toHaveTextContent('Import complete. Tasks imported: 1.')
  })
})
