import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FitnessPage } from '@/components/lifeos/fitness/fitness-page'
import { createQueryWrapper } from '../utils/test-utils'
import { server } from '../mocks/server'
import type { FitnessPlan, FitnessSession } from '@/lib/api/hooks'

describe('FitnessPage', () => {
  it('creates a plan, starts a workout, records a set, completes it, and shows history', async () => {
    const user = userEvent.setup()
    const root = '/api/personal-workbench/lifeos/fitness'
    let plan: FitnessPlan | null = null
    let session: FitnessSession | null = null
    server.use(
      http.get(`*${root}/plans`, () => HttpResponse.json(plan ? [plan] : [])),
      http.post(`*${root}/plans`, async ({ request }) => {
        const body = await request.json() as { name: string; exercises: string[] }
        plan = { id: 'plan-1', name: body.name, description: null, exercises: body.exercises.map((name, position) => ({ id: `plan-ex-${position}`, name, position })) }
        return HttpResponse.json(plan, { status: 201 })
      }),
      http.get(`*${root}/sessions`, () => HttpResponse.json(session ? [session] : [])),
      http.post(`*${root}/sessions`, () => {
        session = { id: 'session-1', planId: 'plan-1', title: 'Strength A', status: 'active', startedAt: new Date().toISOString(), endedAt: null,
          exercises: (plan?.exercises || []).map((exercise, position) => ({ id: `session-ex-${position}`, name: exercise.name, position, sets: [] })) }
        return HttpResponse.json(session, { status: 201 })
      }),
      http.post(`*${root}/sessions/:sessionId/sets`, async ({ request }) => {
        const body = await request.json() as { exerciseId: string; reps: number; weightKg: number }
        const exercise = session?.exercises.find(value => value.id === body.exerciseId)
        if (!exercise) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
        exercise.sets.push({ id: 'set-1', setNumber: exercise.sets.length + 1, reps: body.reps, weightKg: body.weightKg })
        return HttpResponse.json(exercise.sets.at(-1), { status: 201 })
      }),
      http.patch(`*${root}/sessions/:sessionId`, () => {
        if (!session) return HttpResponse.json({ error: 'Not found' }, { status: 404 })
        session.status = 'completed'; session.endedAt = new Date().toISOString()
        return HttpResponse.json(session)
      }),
    )
    render(<FitnessPage />, { wrapper: createQueryWrapper() })

    await user.type(await screen.findByLabelText('Plan name'), 'Strength A')
    await user.type(screen.getByLabelText('Exercises'), 'Squat, Row')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    await screen.findByText('Strength A')
    await user.click(screen.getByRole('button', { name: 'Start workout' }))
    await screen.findByText('Workout in progress')
    await user.type(screen.getAllByLabelText('Weight in kg')[0], '40')
    await user.click(screen.getAllByRole('button', { name: /Set/ })[0])
    await waitFor(() => expect(screen.getByText('8 × 40 kg')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Finish workout' }))
    await waitFor(() => expect(screen.queryByText('Workout in progress')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Training history' })).toBeInTheDocument()
    expect(screen.getAllByText(/Strength A/).length).toBeGreaterThanOrEqual(1)
  })

  it('shows an actionable empty state when the user has no plans', async () => {
    server.use(
      http.get('*/api/personal-workbench/lifeos/fitness/plans', () => HttpResponse.json([])),
      http.get('*/api/personal-workbench/lifeos/fitness/sessions', () => HttpResponse.json([])),
    )
    render(<FitnessPage />, { wrapper: createQueryWrapper() })
    expect(await screen.findByText('No training plans yet')).toBeInTheDocument()
    expect(screen.getByLabelText('Plan name')).toBeInTheDocument()
  })
})
