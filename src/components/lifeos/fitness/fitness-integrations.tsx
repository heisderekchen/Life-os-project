'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Brain, HeartPulse, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useFitnessCoach, useFitnessCoachStatus, type FitnessSession, type HealthKitWorkoutSummary } from '@/lib/api/hooks'
import { uiText } from '@/lib/i18n/interface-copy'

type NativeWindow = Window & {
  webkit?: { messageHandlers?: Record<string, { postMessage: (message: unknown) => void }> }
}
type HealthKitReply = {
  requestId: string
  ok: boolean
  summary?: { periodDays: number; workouts: HealthKitWorkoutSummary[] }
  error?: string
}
type HealthKitEvent = CustomEvent<HealthKitReply>

function volume(session: FitnessSession) {
  return session.exercises.reduce((sum, exercise) => sum + exercise.sets.reduce((sets, set) => sets + set.reps * set.weightKg, 0), 0)
}

export function FitnessIntegrations({ sessions }: { sessions: FitnessSession[] }) {
  const [nativeAvailable, setNativeAvailable] = useState(false)
  const [healthKitSummary, setHealthKitSummary] = useState<{ periodDays: number; workouts: HealthKitWorkoutSummary[] } | null>(null)
  const [healthKitLoading, setHealthKitLoading] = useState(false)
  const [healthKitError, setHealthKitError] = useState('')
  const [consentToSend, setConsentToSend] = useState(false)
  const [includeAppleHealth, setIncludeAppleHealth] = useState(false)
  const [advice, setAdvice] = useState('')
  const pendingRequestId = useRef('')
  const requestTimeout = useRef<number | null>(null)
  const coachStatus = useFitnessCoachStatus()
  const coach = useFitnessCoach()

  useEffect(() => {
    setNativeAvailable(Boolean((window as NativeWindow).webkit?.messageHandlers?.myosHealthKit))
  }, [])

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as HealthKitEvent).detail
      if (!detail || detail.requestId !== pendingRequestId.current) return
      pendingRequestId.current = ''
      if (requestTimeout.current !== null) window.clearTimeout(requestTimeout.current)
      requestTimeout.current = null
      setHealthKitLoading(false)
      if (detail.ok && detail.summary && Array.isArray(detail.summary.workouts)) {
        const workouts = detail.summary.workouts.slice(0, 30)
        setHealthKitSummary({ periodDays: Math.max(1, Math.min(30, detail.summary.periodDays || 30)), workouts })
        setHealthKitError(workouts.length ? '' : uiText('No workout summaries returned. Check Health access in iOS Settings, or try another date range.'))
        setIncludeAppleHealth(false)
      } else {
        setHealthKitError(detail.error === 'HEALTH_DATA_UNAVAILABLE'
          ? uiText('Could not read Apple Health workouts. Try again.')
          : uiText('Could not read Apple Health workouts. Try again.'))
      }
    }
    window.addEventListener('myos:healthkit-result', receive)
    return () => {
      window.removeEventListener('myos:healthkit-result', receive)
      if (requestTimeout.current !== null) window.clearTimeout(requestTimeout.current)
      pendingRequestId.current = ''
    }
  }, [])

  const requestHealthKit = () => {
    const handler = (window as NativeWindow).webkit?.messageHandlers?.myosHealthKit
    if (!handler || healthKitLoading) return
    const requestId = crypto.randomUUID()
    pendingRequestId.current = requestId
    if (requestTimeout.current !== null) window.clearTimeout(requestTimeout.current)
    setHealthKitError('')
    setHealthKitLoading(true)
    handler.postMessage({ action: 'readSummary', requestId, daysBack: 30 })
    requestTimeout.current = window.setTimeout(() => {
      if (pendingRequestId.current !== requestId) return
      pendingRequestId.current = ''
      requestTimeout.current = null
      setHealthKitLoading(false)
      setHealthKitError(uiText('Could not read Apple Health workouts. Try again.'))
    }, 60_000)
  }

  const myOsWorkouts = useMemo(() => sessions.slice(0, 30).map(session => ({
    source: 'myos', activity: session.title, startedAt: session.startedAt,
    durationMinutes: session.endedAt ? Math.max(0, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60_000)) : 0,
    sets: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    volumeKg: Math.round(volume(session)),
  })), [sessions])
  const providerReady = coachStatus.data?.enabled === true && coachStatus.data.providers?.deepseek === true
  const appleHealthWorkouts = includeAppleHealth ? (healthKitSummary?.workouts || []).map(workout => ({ ...workout, source: 'apple_health' })) : []
  const selectedCount = myOsWorkouts.length + appleHealthWorkouts.length
  const generate = async () => {
    if (!consentToSend || !selectedCount) return
    try {
      const response = await coach.mutateAsync({
        consent: true,
        summary: { periodDays: 30, workouts: [...myOsWorkouts, ...appleHealthWorkouts] },
      })
      setAdvice(response.advice)
    } catch {
      setAdvice('')
    }
  }

  return <section className="grid gap-5 lg:grid-cols-2" aria-label={uiText('Fitness integrations')}>
    <Card className="border-border/70">
      <CardHeader>
        <div className="flex items-center gap-2"><span className="rounded-xl bg-rose-500/10 p-2 text-rose-600"><HeartPulse className="h-5 w-5" /></span><CardTitle>{uiText('Apple Health workouts')}</CardTitle></div>
        <CardDescription>{uiText('Read-only connection from this iPhone app. MyOS requests recent workouts, duration, distance, active energy, and average/peak heart rate. Summaries stay in this page session and go to DeepSeek only if you separately opt in to coaching.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" className="min-h-11 rounded-xl" onClick={requestHealthKit} disabled={!nativeAvailable || healthKitLoading}>
        {healthKitLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Activity className="mr-2 h-4 w-4" />}
          {healthKitLoading ? uiText('Connecting…') : uiText('Connect Apple Health')}
        </Button>
        {!nativeAvailable && <p className="text-sm text-muted-foreground">{uiText('Open this page in the MyOS iPhone app to connect Apple Health.')}</p>}
        {healthKitError && <p role="status" className="text-sm text-muted-foreground">{healthKitError}</p>}
        {healthKitSummary && healthKitSummary.workouts.length > 0 && <div className="space-y-2" aria-live="polite">
          <p className="text-sm font-medium">{healthKitSummary.workouts.length} {uiText('workouts · last 30 days')}</p>
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-border/70 p-3">
            {healthKitSummary.workouts.slice(0, 8).map((workout, index) => <div key={`${workout.startedAt}-${index}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{workout.activity}</span><span className="text-muted-foreground">{Math.round(workout.durationMinutes)} min{workout.averageHeartRateBpm ? ` · ${Math.round(workout.averageHeartRateBpm)} bpm avg` : ''}{workout.distanceKm ? ` · ${workout.distanceKm.toFixed(1)} km` : ''}</span>
            </div>)}
          </div>
        </div>}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{uiText('HealthKit permission is read-only and can be changed in iOS Settings.')}</p>
      </CardContent>
    </Card>

    <Card className="border-border/70">
      <CardHeader>
        <div className="flex items-center gap-2"><span className="rounded-xl bg-primary/10 p-2 text-primary"><Brain className="h-5 w-5" /></span><CardTitle>{uiText('AI training coach')}</CardTitle></div>
        <CardDescription>{uiText('Review recent training and get one-time, general fitness suggestions.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!providerReady && <p role="status" className="rounded-xl bg-muted/70 p-3 text-sm text-muted-foreground">{uiText('Coach service is not configured yet.')}</p>}
        <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={consentToSend} onChange={event => setConsentToSend(event.target.checked)} />
          <span>{uiText('Send my MyOS training summary to DeepSeek for a one-time suggestion. This is general fitness information, not medical advice.')}</span>
        </label>
        <label className={`flex items-start gap-3 rounded-xl border border-border/70 p-3 text-sm ${!healthKitSummary?.workouts.length ? 'opacity-60' : ''}`}>
          <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={includeAppleHealth} disabled={!healthKitSummary?.workouts.length} onChange={event => setIncludeAppleHealth(event.target.checked)} />
          <span>{uiText('Also include Apple Health workout summaries')}<span className="mt-1 block text-xs text-muted-foreground">{healthKitSummary?.workouts.length ? `${healthKitSummary.workouts.length} ${uiText('workouts · last 30 days')}` : uiText('No Apple Health workout summaries are loaded yet.')}</span></span>
        </label>
        <p className="text-xs text-muted-foreground">{uiText('The coach does not diagnose or treat health conditions. Your summary is not saved as a coaching conversation.')}</p>
        {coach.error && <p role="alert" className="text-sm text-destructive">{uiText('Coach service is unavailable. Try again later.')}</p>}
        <Button className="min-h-11 rounded-xl" onClick={() => void generate()} disabled={!providerReady || !consentToSend || selectedCount === 0 || coach.isPending}>
          {coach.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Brain className="mr-2 h-4 w-4" />}
          {coach.isPending ? uiText('Generating…') : uiText('Generate suggestion')}
        </Button>
        {advice && <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6" aria-live="polite"><p className="mb-2 font-medium">{uiText('AI training coach')}</p><p className="whitespace-pre-wrap">{advice}</p></div>}
      </CardContent>
    </Card>
  </section>
}

declare global {
  interface Window { __myosHealthKitReceive?: (reply: HealthKitReply) => void }
}

// The native wrapper dispatches only a small, read-only aggregate. No sample
// series, identifiers, or HealthKit authorization tokens cross the bridge.
if (typeof window !== 'undefined') {
  window.__myosHealthKitReceive = reply => window.dispatchEvent(new CustomEvent('myos:healthkit-result', { detail: reply }))
}
