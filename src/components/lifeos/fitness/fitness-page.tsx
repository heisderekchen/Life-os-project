'use client'

import { useMemo, useState } from 'react'
import { Activity, Check, Dumbbell, LoaderCircle, Plus, Play, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ModulePageHeader } from '@/components/lifeos/shared/module-page-header'
import { FitnessIntegrations } from '@/components/lifeos/fitness/fitness-integrations'
import { uiText, useInterfaceLanguage } from '@/lib/i18n/interface-copy'
import { useTranslation } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { useAddFitnessSet, useCreateFitnessPlan, useFinishFitnessSession, useFitnessPlans, useFitnessSessions, useStartFitnessSession, type FitnessSession } from '@/lib/api/hooks'

const fieldClass = 'h-11 min-w-0 rounded-xl border-border/70 bg-background/80'

function sessionVolume(session: FitnessSession) {
  return session.exercises.reduce((total, exercise) => total + exercise.sets.reduce((sum, set) => sum + set.reps * set.weightKg, 0), 0)
}

export function FitnessPage() {
  useInterfaceLanguage()
  const { t } = useTranslation()
  const plans = useFitnessPlans()
  const sessions = useFitnessSessions()
  const createPlan = useCreateFitnessPlan()
  const startSession = useStartFitnessSession()
  const addSet = useAddFitnessSet()
  const finishSession = useFinishFitnessSession()
  const [planName, setPlanName] = useState('')
  const [exerciseText, setExerciseText] = useState('')
  const [inputs, setInputs] = useState<Record<string, { reps: string; weight: string }>>({})
  const activeSession = sessions.data?.find(session => session.status === 'active')
  const completed = useMemo(() => (sessions.data || []).filter(session => session.status === 'completed'), [sessions.data])
  const totalVolume = useMemo(() => completed.reduce((sum, session) => sum + sessionVolume(session), 0), [completed])

  const create = async () => {
    const exercises = exerciseText.split(/\n|,/).map(value => value.trim()).filter(Boolean)
    if (!planName.trim() || !exercises.length) return
    try {
      await createPlan.mutateAsync({ name: planName.trim(), exercises })
      setPlanName(''); setExerciseText('')
      showToast.success(uiText('Training plan saved'))
    } catch { showToast.error(uiText('Could not save this plan. Try again.')) }
  }

  const recordSet = async (sessionId: string, exerciseId: string) => {
    const value = inputs[exerciseId] || { reps: '8', weight: '' }
    const reps = Number(value.reps); const weightKg = Number(value.weight)
    if (!Number.isInteger(reps) || reps < 1 || !value.weight.trim() || !Number.isFinite(weightKg) || weightKg < 0) return
    try {
      await addSet.mutateAsync({ sessionId, exerciseId, reps, weightKg })
      showToast.success(uiText('Set saved'))
    } catch { showToast.error(uiText('Could not save this set. Try again.')) }
  }

  const start = async (planId: string) => {
    try { await startSession.mutateAsync(planId) }
    catch { showToast.error(uiText('Could not start this workout. Try again.')) }
  }

  return <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-5 sm:px-7 sm:py-8">
    <ModulePageHeader eyebrow={t('nav.wellness')} title={t('nav.fitness')} description={uiText('Build a plan, record each set, and see your training history over time.')} />

    <section className="grid gap-3 sm:grid-cols-3" aria-label={uiText('Training progress')}>
      <Card className="border-border/70 bg-card/80"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Dumbbell className="h-5 w-5" /></span><div><p className="text-xs text-muted-foreground">{uiText('Completed workouts')}</p><p className="text-2xl font-semibold tabular-nums">{completed.length}</p></div></CardContent></Card>
      <Card className="border-border/70 bg-card/80"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600"><Activity className="h-5 w-5" /></span><div><p className="text-xs text-muted-foreground">{uiText('Recorded sets')}</p><p className="text-2xl font-semibold tabular-nums">{completed.reduce((n, session) => n + session.exercises.reduce((m, exercise) => m + exercise.sets.length, 0), 0)}</p></div></CardContent></Card>
      <Card className="border-border/70 bg-card/80"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-xl bg-amber-500/10 p-2.5 text-amber-600"><Trophy className="h-5 w-5" /></span><div><p className="text-xs text-muted-foreground">{uiText('Total volume')} · kg</p><p className="text-2xl font-semibold tabular-nums">{Math.round(totalVolume).toLocaleString()}</p></div></CardContent></Card>
    </section>

    {activeSession && <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm">
      <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">{uiText('Workout in progress')}</p><CardTitle className="text-xl">{activeSession.title}</CardTitle><CardDescription>{new Date(activeSession.startedAt).toLocaleString()}</CardDescription></div><Button className="min-h-11 rounded-xl" onClick={() => finishSession.mutate({ sessionId: activeSession.id }, { onError: () => showToast.error(uiText('Could not finish this workout. Try again.')) })} disabled={finishSession.isPending}><Check className="mr-2 h-4 w-4" />{uiText('Finish workout')}</Button></div></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">{activeSession.exercises.map(exercise => {
        const value = inputs[exercise.id] || { reps: '8', weight: '' }
        return <div key={exercise.id} className="rounded-2xl border border-border/70 bg-background/75 p-4">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold">{exercise.name}</h3><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{exercise.sets.length} {uiText('sets')}</span></div>
          {exercise.sets.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{exercise.sets.map(set => <span key={set.id} className="rounded-lg bg-primary/8 px-2.5 py-1.5 text-xs tabular-nums">{set.reps} × {set.weightKg} kg</span>)}</div>}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2"><label className="sr-only" htmlFor={`reps-${exercise.id}`}>{uiText('Reps')}</label><Input id={`reps-${exercise.id}`} className={fieldClass} inputMode="numeric" type="number" min="1" value={value.reps} onChange={event => setInputs(current => ({ ...current, [exercise.id]: { ...value, reps: event.target.value } }))} aria-label={uiText('Reps')} /><label className="sr-only" htmlFor={`weight-${exercise.id}`}>{uiText('Weight in kg')}</label><Input id={`weight-${exercise.id}`} className={fieldClass} inputMode="decimal" type="number" min="0" step="0.5" value={value.weight} onChange={event => setInputs(current => ({ ...current, [exercise.id]: { ...value, weight: event.target.value } }))} aria-label={uiText('Weight in kg')} /><Button variant="secondary" className="min-h-11 rounded-xl px-3" disabled={addSet.isPending} onClick={() => recordSet(activeSession.id, exercise.id)}><Plus className="mr-1 h-4 w-4" />{uiText('Set')}</Button></div>
        </div>
      })}</CardContent>
    </Card>}

    <FitnessIntegrations sessions={completed} />

    <div className="grid items-start gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <Card className="border-border/70"><CardHeader><CardTitle>{uiText('Create a training plan')}</CardTitle><CardDescription>{uiText('Add exercise names on separate lines or split them with commas.')}</CardDescription></CardHeader><CardContent className="space-y-3"><Input className={fieldClass} value={planName} onChange={event => setPlanName(event.target.value)} placeholder={uiText('Plan name')} aria-label={uiText('Plan name')} /><label htmlFor="fitness-exercises" className="sr-only">{uiText('Exercises')}</label><textarea id="fitness-exercises" className="min-h-28 w-full resize-y rounded-xl border border-border/70 bg-background/80 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={exerciseText} onChange={event => setExerciseText(event.target.value)} placeholder={uiText('Squat\nBench press\nRow')} /><Button className="min-h-11 w-full rounded-xl" disabled={!planName.trim() || !exerciseText.trim() || createPlan.isPending} onClick={create}>{createPlan.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{uiText('Save plan')}</Button></CardContent></Card>

      <Card className="border-border/70"><CardHeader><CardTitle>{uiText('Your plans')}</CardTitle><CardDescription>{uiText('Start a workout from any saved plan.')}</CardDescription></CardHeader><CardContent className="space-y-3">{plans.isLoading || sessions.isLoading ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />{uiText('Loading training data…')}</div> : plans.isError || sessions.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{uiText('Training data could not be loaded.')}</p><Button variant="link" className="mt-1 h-auto p-0" onClick={() => { void plans.refetch(); void sessions.refetch() }}>{uiText('Try again')}</Button></div> : plans.data?.length ? plans.data.map(plan => <div key={plan.id} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="truncate font-semibold">{plan.name}</h3><p className="mt-1 text-sm text-muted-foreground">{plan.exercises.map(exercise => exercise.name).join(' · ')}</p></div><Button variant="outline" className="min-h-11 shrink-0 rounded-xl" disabled={Boolean(activeSession) || startSession.isPending} onClick={() => start(plan.id)}><Play className="mr-2 h-4 w-4" />{uiText('Start workout')}</Button></div>) : <div className="rounded-2xl border border-dashed border-border p-6 text-center"><Dumbbell className="mx-auto mb-3 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">{uiText('No training plans yet')}</p><p className="mt-1 text-sm text-muted-foreground">{uiText('Create your first plan to get started.')}</p></div>}</CardContent></Card>
    </div>

    <section className="space-y-3"><div><h2 className="text-lg font-semibold">{uiText('Training history')}</h2><p className="text-sm text-muted-foreground">{uiText('Recent workouts and logged sets.')}</p></div>{completed.length ? completed.map(session => <Card key={session.id} className="border-border/70"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{session.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(session.startedAt).toLocaleString()} · {session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} {uiText('sets')}</p></div><p className="text-sm font-semibold tabular-nums">{Math.round(sessionVolume(session)).toLocaleString()} kg · {uiText('volume')}</p></CardContent></Card>) : <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{uiText('Completed workouts will appear here.')}</p>}</section>
  </div>
}
