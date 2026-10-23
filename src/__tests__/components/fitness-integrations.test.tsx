import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { FitnessIntegrations } from '@/components/lifeos/fitness/fitness-integrations'

const session = {
  id: 'session-1', planId: null, status: 'completed' as const, title: 'Strength day', startedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-22T11:00:00.000Z',
  exercises: [{ id: 'exercise-1', name: 'Squat', position: 0, sets: [{ id: 'set-1', setNumber: 1, reps: 5, weightKg: 50 }] }],
}

function setup() {
  const requests: Record<string, unknown>[] = []
  server.use(
    http.get('*/api/agent/health', () => HttpResponse.json({ enabled: true, providers: { deepseek: true } })),
    http.post('*/api/agent/fitness-coach', async ({ request }) => {
      requests.push(await request.json() as Record<string, unknown>)
      return HttpResponse.json({ advice: 'Keep the next session easy.', provider: 'deepseek', model: 'test' })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><FitnessIntegrations sessions={[session]} /></QueryClientProvider>)
  return requests
}

describe('fitness coach and Apple Health consent flow', () => {
  afterEach(() => {
    cleanup()
    delete (window as Window & { webkit?: unknown }).webkit
  })

  it('keeps Apple Health optional and sends only selected summaries after explicit consent', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'webkit', { configurable: true, value: { messageHandlers: { myosHealthKit: { postMessage } } } })
    const requests = setup()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Connect Apple Health' }))
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'readSummary', daysBack: 30 }))
    const requestId = postMessage.mock.calls[0][0].requestId as string
    act(() => window.__myosHealthKitReceive?.({
      requestId, ok: true, summary: { periodDays: 30, workouts: [{ activity: 'Running', startedAt: '2026-10-22T07:00:00.000Z', durationMinutes: 25, distanceKm: 4.2, activeEnergyKcal: 210, averageHeartRateBpm: 142, peakHeartRateBpm: 166 }] },
    }))
    expect(await screen.findByText('Running')).toBeInTheDocument()

    const appleConsent = screen.getByRole('checkbox', { name: /Also include Apple Health workout summaries/ })
    expect(appleConsent).not.toBeChecked()
    const generate = screen.getByRole('button', { name: 'Generate suggestion' })
    expect(generate).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Send my MyOS training summary to DeepSeek/ }))
    expect(generate).toBeEnabled()
    await user.click(generate)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect((requests[0].summary as { workouts: Array<{ source: string }> }).workouts.map(workout => workout.source)).toEqual(['myos'])

    await user.click(appleConsent)
    await user.click(generate)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect((requests[1].summary as { workouts: Array<{ source: string }> }).workouts.map(workout => workout.source)).toEqual(['myos', 'apple_health'])
    expect(await screen.findByText('Keep the next session easy.')).toBeInTheDocument()
  })

  it('shows a specific native bridge failure and allows another attempt', async () => {
    const postMessage = vi.fn()
    Object.defineProperty(window, 'webkit', { configurable: true, value: { messageHandlers: { myosHealthKit: { postMessage } } } })
    setup()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Connect Apple Health' }))
    const requestId = postMessage.mock.calls[0][0].requestId as string
    act(() => window.__myosHealthKitReceive?.({ requestId, ok: false, error: 'HEALTH_BRIDGE_ORIGIN_REJECTED' }))

    expect(await screen.findByText('This MyOS page could not verify its iPhone HealthKit connection. Reopen it in the MyOS iPhone app.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Apple Health' })).toBeEnabled()
  })
})
