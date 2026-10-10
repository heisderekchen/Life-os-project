import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { ProjectsPage } from '@/components/lifeos/projects/projects-page'
import { useAppStore } from '@/stores/app-store'

type TestProject = Record<string, any> & { id: string; name: string; archived?: boolean }

function setupProjectApi(initial: TestProject[] = []) {
  let projects = [...initial]
  let lastPatch: { id: string; body: Record<string, unknown> } | null = null
  let deleteCount = 0

  server.use(
    http.get('*/api/projects', () => HttpResponse.json(projects)),
    http.post('*/api/projects', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      const created = {
        id: `project-${projects.length + 1}`,
        description: '',
        color: '#6b7280',
        status: 'active',
        archived: false,
        taskCount: 0,
        ...body,
      }
      projects = [created, ...projects]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch('*/api/projects/:id', async ({ params, request }) => {
      const body = await request.json() as Record<string, unknown>
      const id = String(params.id)
      lastPatch = { id, body }
      projects = projects.map((project) => project.id === id ? { ...project, ...body } : project)
      const updated = projects.find((project) => project.id === id)
      return updated ? HttpResponse.json(updated) : HttpResponse.json({ error: 'Not found' }, { status: 404 })
    }),
    http.delete('*/api/projects/:id', ({ params }) => {
      deleteCount += 1
      projects = projects.filter((project) => project.id !== params.id)
      return HttpResponse.json({ success: true })
    }),
  )

  return {
    projects: () => projects,
    lastPatch: () => lastPatch,
    deleteCount: () => deleteCount,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}><ProjectsPage /></QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  server.resetHandlers()
  useAppStore.setState({ language: 'en', activeModule: 'projects' })
})

const sampleProject = (overrides: Partial<TestProject> = {}): TestProject => ({
  id: 'project-alpha',
  name: 'Field notes',
  description: 'Plan the next research trip',
  color: '#0f766e',
  status: 'active',
  archived: false,
  startDate: null,
  endDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  _count: { tasks: 3 },
  ...overrides,
})

describe('ProjectsPage', () => {
  it('shows project details and task count from the existing projects API', async () => {
    setupProjectApi([sampleProject()])
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Field notes' })).toBeInTheDocument()
    expect(screen.getByText('Plan the next research trip')).toBeInTheDocument()
    expect(screen.getByText('3 tasks')).toBeInTheDocument()
  })

  it('creates and edits projects through existing CRUD routes', async () => {
    const api = setupProjectApi()
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Create your first project' }))
    await user.type(screen.getByLabelText('Project name'), 'Quarterly goals')
    await user.click(screen.getAllByRole('button', { name: 'New project', exact: true }).slice(-1)[0])

    expect(await screen.findByRole('heading', { name: 'Quarterly goals' })).toBeInTheDocument()
    expect(api.projects()).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Edit Quarterly goals' }))
    const nameInput = screen.getByLabelText('Project name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Quarterly roadmap')
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }))

    expect(await screen.findByRole('heading', { name: 'Quarterly roadmap' })).toBeInTheDocument()
    expect(api.lastPatch()?.body).toMatchObject({ name: 'Quarterly roadmap' })
  })

  it('archives projects and requires confirmation before deletion', async () => {
    const api = setupProjectApi([sampleProject()])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Archive Field notes' }))
    await waitFor(() => expect(api.lastPatch()?.body).toMatchObject({ archived: true }))
    await user.click(screen.getByRole('tab', { name: 'Archived' }))
    expect(await screen.findByRole('heading', { name: 'Field notes' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Field notes' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(api.deleteCount()).toBe(0)
    expect(screen.getByText(/Its tasks will stay in your workspace/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete project', exact: true }))
    await waitFor(() => expect(api.deleteCount()).toBe(1))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Field notes' })).not.toBeInTheDocument())
  })
})
