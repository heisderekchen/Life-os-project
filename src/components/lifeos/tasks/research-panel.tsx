'use client'

// Research state-machine + disabled Obsidian sync view for the current Life OS
// task detail. It talks only to the standalone research API (same origin, base
// path aware) and never calls a model provider: there is no executor connected,
// so an explicit start only persists `waiting_executor`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

const EXECUTOR_WAITING_MESSAGE = '等待 Neo/研究执行器连接'
const OBSIDIAN_FOLDER_HINT = '已授权文件夹内的 .md 相对路径'

type Caps = {
  maxRounds: number; maxConcurrency: number; maxSubtasks: number; maxSources: number; maxActions: number
  maxCostLimitUsd: number; minFrequencyMinutes: number; maxFrequencyMinutes: number
}
type Executor = { connected: boolean; status: string; reason: string; message: string }
type Obsidian = { enabled: boolean; configured: boolean; status: string; reason: string; message: string; pendingCount: number }
type CatalogResponse = {
  caps: Caps
  modes: { id: string; label: string }[]
  statuses: { id: string; label: string }[]
  confidence: { id: string; label: string }[]
  sources: { id: string; label: string }[]
  actions: { id: string; label: string }[]
  executor: Executor
  obsidian: Obsidian
}
type Session = {
  id: string; taskId: string; mode: string; goal: string; target: string
  sourceAllowlist: string[]; actionAllowlist: string[]; unresolvedQuestions: string[]; nextQuestion: string
  checkpoint: Record<string, unknown>; costLimitUsd: number; costSpentUsd: number
  frequencyMinutes: number; nextCheckAt: string | null; subtaskCap: number; maxConcurrency: number; maxRounds: number
  roundCount: number; noNewEvidenceStreak: number; status: string; terminalReason: string | null
  executor: Executor; createdAt: string; updatedAt: string
}
type Round = { roundIndex: number; status: string; newEvidenceCount: number; duplicateEvidenceCount: number; noNewEvidenceStreak: number; nextCheckAt: string | null; terminalReason: string | null; summary: string; createdAt: string }
type Evidence = { dedupeKey: string; source: string; sourceRef: string; summary: string; observedDate: string | null; confidence: string; roundIndex: number | null; createdAt: string }
type Outbox = { id: string; relativePath: string; title: string; status: string; expectedBaseHash: string | null; conflictReason: string | null; citations: string[]; createdAt: string }
type TaskResponse = { taskId: string; session: Session | null; rounds: Round[]; evidence: Evidence[]; outbox: Outbox[]; executor: Executor; obsidian: Obsidian }

type PlanForm = {
  mode: string; goal: string; target: string; sourceAllowlist: string[]; actionAllowlist: string[]
  unresolvedQuestions: string; nextQuestion: string; checkpoint: string
  costLimitUsd: string; frequencyMinutes: string; subtaskCap: string; maxConcurrency: string; maxRounds: string
}

const emptyPlan = (): PlanForm => ({
  mode: 'once', goal: '', target: '', sourceAllowlist: [], actionAllowlist: [],
  unresolvedQuestions: '', nextQuestion: '', checkpoint: '{}',
  costLimitUsd: '1', frequencyMinutes: '60', subtaskCap: '1', maxConcurrency: '1', maxRounds: '1',
})

const linesOf = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(path), {
    cache: 'no-store',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((value as { error?: string }).error || `HTTP_${response.status}`)
  return value as T
}

const TERMINAL = ['cancelled', 'stopped']

export function ResearchPanel({ taskId }: { taskId: string }) {
  const [caps, setCaps] = useState<Caps | null>(null)
  const [modes, setModes] = useState<{ id: string; label: string }[]>([])
  const [statuses, setStatuses] = useState<{ id: string; label: string }[]>([])
  const [sources, setSources] = useState<{ id: string; label: string }[]>([])
  const [actions, setActions] = useState<{ id: string; label: string }[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [outbox, setOutbox] = useState<Outbox[]>([])
  const [obsidianStatus, setObsidianStatus] = useState<Obsidian | null>(null)
  const [plan, setPlan] = useState<PlanForm>(emptyPlan)
  const [obsidianForm, setObsidianForm] = useState({ relativePath: '', title: '', body: '', citations: '' })
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [catalog, task] = await Promise.all([
        call<CatalogResponse>('/api/research/catalog'),
        call<TaskResponse>(`/api/research/tasks/${encodeURIComponent(taskId)}`),
      ])
      setCaps(catalog.caps)
      if (catalog.modes?.length) setModes(catalog.modes)
      if (catalog.statuses?.length) setStatuses(catalog.statuses)
      setSources(catalog.sources || [])
      setActions(catalog.actions || [])
      setSession(task.session)
      setRounds(task.rounds || [])
      setEvidence(task.evidence || [])
      setOutbox(task.outbox || [])
      setObsidianStatus(task.obsidian || catalog.obsidian || null)
      if (task.session) {
        setPlan({
          mode: task.session.mode,
          goal: task.session.goal,
          target: task.session.target || '',
          sourceAllowlist: task.session.sourceAllowlist,
          actionAllowlist: task.session.actionAllowlist,
          unresolvedQuestions: task.session.unresolvedQuestions.join('\n'),
          nextQuestion: task.session.nextQuestion || '',
          checkpoint: JSON.stringify(task.session.checkpoint ?? {}, null, 2),
          costLimitUsd: String(task.session.costLimitUsd),
          frequencyMinutes: String(task.session.frequencyMinutes),
          subtaskCap: String(task.session.subtaskCap),
          maxConcurrency: String(task.session.maxConcurrency),
          maxRounds: String(task.session.maxRounds),
        })
        setEditing(task.session.status === 'draft')
      } else {
        setPlan(emptyPlan())
        setEditing(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'RESEARCH_LOAD_FAILED')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { void refresh() }, [refresh])

  const modeLabel = (id: string) => modes.find(entry => entry.id === id)?.label || id
  const statusLabel = (id: string) => statuses.find(entry => entry.id === id)?.label || id
  const optionLabel = (options: { id: string; label: string }[], id: string) => options.find(entry => entry.id === id)?.label || id
  const executor = session?.executor
  const pendingCount = useMemo(() => outbox.filter(entry => entry.status === 'pending_sync').length, [outbox])

  const run = async (work: () => Promise<void>, fallback: string, message: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
      setNotice(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const savePlan = () => run(async () => {
    let checkpoint: Record<string, unknown> = {}
    try { checkpoint = JSON.parse(plan.checkpoint || '{}') } catch { throw new Error('检查点必须是合法 JSON。') }
    await call(`/api/research/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        mode: plan.mode,
        goal: plan.goal.trim(),
        target: plan.target.trim(),
        sourceAllowlist: plan.sourceAllowlist,
        actionAllowlist: plan.actionAllowlist,
        unresolvedQuestions: linesOf(plan.unresolvedQuestions),
        nextQuestion: plan.nextQuestion.trim(),
        checkpoint,
        costLimitUsd: Number(plan.costLimitUsd || 0),
        frequencyMinutes: Number(plan.frequencyMinutes || 0),
        subtaskCap: Number(plan.subtaskCap || 0),
        maxConcurrency: Number(plan.maxConcurrency || 1),
        maxRounds: Number(plan.maxRounds || 1),
      }),
    })
    setEditing(false)
    await refresh()
  }, 'RESEARCH_PLAN_SAVE_FAILED', '研究计划已保存为草稿（不会立即运行）')

  const transition = (action: 'start' | 'pause' | 'resume' | 'cancel', message: string) =>
    run(async () => {
      await call(`/api/research/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' })
      await refresh()
    }, `RESEARCH_${action.toUpperCase()}_FAILED`, message)

  const stageObsidian = () => run(async () => {
    await call(`/api/research/tasks/${encodeURIComponent(taskId)}/obsidian`, {
      method: 'POST',
      body: JSON.stringify({
        relativePath: obsidianForm.relativePath.trim(),
        title: obsidianForm.title.trim(),
        body: obsidianForm.body,
        citations: linesOf(obsidianForm.citations),
      }),
    })
    setObsidianForm({ relativePath: '', title: '', body: '', citations: '' })
    await refresh()
  }, 'OBSIDIAN_STAGE_FAILED', '已暂存为待同步（不会写入任何文件）')

  const isActive = Boolean(session && ['waiting_executor', 'paused'].includes(session.status))
  const isTerminal = Boolean(session && TERMINAL.includes(session.status))

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5" aria-label="研究状态机与 Obsidian 同步">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">研究</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            计划/创建只保存草稿，不会运行；显式开始后仅进入「{EXECUTOR_WAITING_MESSAGE}」。服务端持有不可放宽的执行上限。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {session && <Badge variant="outline" className="text-xs">{statusLabel(session.status)}</Badge>}
          {session && <Badge variant="secondary" className="max-w-full truncate text-xs">{modeLabel(session.mode)}</Badge>}
          {session && !isActive && <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(current => !current)}>{editing ? '查看' : '编辑计划'}</Button>}
        </div>
      </div>

      {loading && <p className="text-xs text-muted-foreground">正在读取研究计划…</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {session && (
        <p className="rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
          执行器：{executor?.message || EXECUTOR_WAITING_MESSAGE}（未连接，不会运行模型，也不会有后台心跳）。
        </p>
      )}

      {!loading && !editing && session && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">目标</p>
              <p className="whitespace-pre-wrap break-words text-sm">{session.goal}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">目标站点/对象</p>
              <p className="break-words text-sm">{session.target || '未填写'}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">来源白名单</p>
              <p className="break-words text-sm text-foreground/85">{session.sourceAllowlist.length ? session.sourceAllowlist.map(id => optionLabel(sources, id)).join('、') : '未限定'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">动作白名单</p>
              <p className="break-words text-sm text-foreground/85">{session.actionAllowlist.length ? session.actionAllowlist.map(id => optionLabel(actions, id)).join('、') : '未限定'}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">成本上限</p>
              <p className="text-sm">${session.costLimitUsd} （已花费 ${session.costSpentUsd}）</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">检查频率</p>
              <p className="text-sm">每 {session.frequencyMinutes} 分钟</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">轮次</p>
              <p className="text-sm">{session.roundCount} / {session.maxRounds}（无新证据连续 {session.noNewEvidenceStreak} 次）</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">子任务上限</p>
              <p className="text-sm">{session.subtaskCap}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">并发上限</p>
              <p className="text-sm">{session.maxConcurrency}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">下次检查</p>
              <p className="text-sm">{session.nextCheckAt ? new Date(session.nextCheckAt).toLocaleString('zh-CN') : '未安排'}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">未解决问题</p>
              {session.unresolvedQuestions.length
                ? <ul className="list-disc space-y-1 pl-5 text-sm">{session.unresolvedQuestions.map(item => <li key={item} className="break-words">{item}</li>)}</ul>
                : <p className="text-sm text-muted-foreground">无</p>}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">下一个问题</p>
              <p className="break-words text-sm">{session.nextQuestion || '未填写'}</p>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">检查点</p>
            <pre className="max-h-32 overflow-auto rounded-md bg-muted/40 p-2 text-[11px]">{JSON.stringify(session.checkpoint ?? {}, null, 2)}</pre>
          </div>
          {session.terminalReason && <p className="text-xs text-muted-foreground">终止原因：{session.terminalReason}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || session.status !== 'draft'} onClick={() => void transition('start', `已进入${EXECUTOR_WAITING_MESSAGE}；不会运行模型`)}>开始研究</Button>
            <Button variant="outline" size="sm" disabled={busy || session.status !== 'waiting_executor'} onClick={() => void transition('pause', '研究已暂停')}>暂停</Button>
            <Button variant="outline" size="sm" disabled={busy || session.status !== 'paused'} onClick={() => void transition('resume', '研究已继续等待执行器')}>继续</Button>
            <Button variant="outline" size="sm" disabled={busy || isTerminal} onClick={() => void transition('cancel', '研究已取消')}>取消</Button>
          </div>
        </div>
      )}

      {!loading && editing && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="text-muted-foreground">模式</span>
              <select className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={plan.mode} onChange={event => setPlan(current => ({ ...current, mode: event.target.value }))}>
                {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">检查频率（分钟，{caps?.minFrequencyMinutes ?? 60}–{caps?.maxFrequencyMinutes ?? 1440}）</span>
              <Input className="mt-1 h-9 text-sm" type="number" min={caps?.minFrequencyMinutes ?? 60} max={caps?.maxFrequencyMinutes ?? 1440} value={plan.frequencyMinutes} onChange={event => setPlan(current => ({ ...current, frequencyMinutes: event.target.value }))} />
            </label>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">研究目标</span>
            <Textarea className="mt-1 min-h-20 text-sm" maxLength={2000} value={plan.goal} onChange={event => setPlan(current => ({ ...current, goal: event.target.value }))} />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">目标站点/对象</span>
            <Input className="mt-1 h-9 text-sm" maxLength={500} value={plan.target} onChange={event => setPlan(current => ({ ...current, target: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">来源（仅服务端提供的安全选项，最多 {caps?.maxSources ?? 20}）</p>
              {sources.length
                ? sources.map(option => (
                  <label key={option.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={plan.sourceAllowlist.includes(option.id)}
                      onChange={() => setPlan(current => ({
                        ...current,
                        sourceAllowlist: current.sourceAllowlist.includes(option.id)
                          ? current.sourceAllowlist.filter(id => id !== option.id)
                          : [...current.sourceAllowlist, option.id],
                      }))}
                    />
                    <span>{option.label} <span className="text-muted-foreground">（{option.id}）</span></span>
                  </label>
                ))
                : <p className="text-xs text-muted-foreground">正在读取服务端来源选项…</p>}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">动作（仅服务端提供的安全选项，最多 {caps?.maxActions ?? 20}）</p>
              {actions.length
                ? actions.map(option => (
                  <label key={option.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={plan.actionAllowlist.includes(option.id)}
                      onChange={() => setPlan(current => ({
                        ...current,
                        actionAllowlist: current.actionAllowlist.includes(option.id)
                          ? current.actionAllowlist.filter(id => id !== option.id)
                          : [...current.actionAllowlist, option.id],
                      }))}
                    />
                    <span>{option.label} <span className="text-muted-foreground">（{option.id}）</span></span>
                  </label>
                ))
                : <p className="text-xs text-muted-foreground">正在读取服务端动作选项…</p>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="text-muted-foreground">未解决问题（每行一项）</span>
              <Textarea className="mt-1 min-h-20 text-sm" value={plan.unresolvedQuestions} onChange={event => setPlan(current => ({ ...current, unresolvedQuestions: event.target.value }))} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">下一个问题</span>
              <Textarea className="mt-1 min-h-20 text-sm" maxLength={500} value={plan.nextQuestion} onChange={event => setPlan(current => ({ ...current, nextQuestion: event.target.value }))} />
            </label>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">检查点（JSON）</span>
            <Textarea className="mt-1 min-h-20 font-mono text-xs" value={plan.checkpoint} onChange={event => setPlan(current => ({ ...current, checkpoint: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs">
              <span className="text-muted-foreground">成本上限 USD（&gt; 0 且 ≤ {caps?.maxCostLimitUsd ?? 1}）</span>
              <Input className="mt-1 h-9 text-sm" type="number" min={0.01} max={caps?.maxCostLimitUsd ?? 1} step="0.01" value={plan.costLimitUsd} onChange={event => setPlan(current => ({ ...current, costLimitUsd: event.target.value }))} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">子任务上限（≤ {caps?.maxSubtasks ?? 1}）</span>
              <Input className="mt-1 h-9 text-sm" type="number" min={0} max={caps?.maxSubtasks ?? 1} value={plan.subtaskCap} onChange={event => setPlan(current => ({ ...current, subtaskCap: event.target.value }))} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">并发上限（≤ {caps?.maxConcurrency ?? 1}）</span>
              <Input className="mt-1 h-9 text-sm" type="number" min={1} max={caps?.maxConcurrency ?? 1} value={plan.maxConcurrency} onChange={event => setPlan(current => ({ ...current, maxConcurrency: event.target.value }))} />
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">最大轮次（≤ {caps?.maxRounds ?? 20}）</span>
              <Input className="mt-1 h-9 text-sm" type="number" min={1} max={caps?.maxRounds ?? 20} value={plan.maxRounds} onChange={event => setPlan(current => ({ ...current, maxRounds: event.target.value }))} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !plan.goal.trim()} onClick={() => void savePlan()}>{busy ? '正在保存…' : '保存为草稿'}</Button>
            {session && <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>取消</Button>}
          </div>
          <p className="text-[10px] text-muted-foreground">预算、频率、来源/动作与并发/子任务上限均由服务端持有，超出上限会被拒绝；客户端不能放宽。</p>
        </div>
      )}

      {session && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium">轮次历史</p>
            {rounds.length
              ? rounds.map(round => (
                <p key={round.roundIndex} className="text-xs text-muted-foreground">
                  第 {round.roundIndex} 轮 · 新证据 {round.newEvidenceCount} · 去重 {round.duplicateEvidenceCount} · {round.status}
                  {round.terminalReason ? ` · ${round.terminalReason}` : ''}
                </p>
              ))
              : <p className="text-xs text-muted-foreground">尚无轮次（未连接执行器）。</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">去重证据</p>
            {evidence.length
              ? evidence.map(entry => (
                <p key={entry.dedupeKey} className="break-words text-xs text-muted-foreground">
                  {entry.source} · {entry.observedDate || '未知日期'} · 置信度 {entry.confidence} — {entry.summary}
                </p>
              ))
              : <p className="text-xs text-muted-foreground">尚无证据。</p>}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
        <p className="text-xs font-medium">Obsidian 同步</p>
        <p className="text-xs text-muted-foreground">
          {obsidianStatus?.message || 'Obsidian 同步未启用：等待 vault 路径与文件系统权限授权。'}
        </p>
        <p className="text-xs text-muted-foreground">待同步条目：{pendingCount}（只暂存，不会写入任何文件）。</p>
        {outbox.map(entry => (
          <p key={entry.id} className="break-all text-xs text-muted-foreground">
            {entry.relativePath} · {entry.title} · {entry.status}{entry.conflictReason ? ` · ${entry.conflictReason}` : ''}
          </p>
        ))}
        {session && (
          <div className="space-y-2 rounded-md border border-border/60 p-2">
            <p className="text-xs font-medium">暂存待同步条目（仅暂存，不写入）</p>
            <Input className="h-9 text-xs" placeholder={`相对路径，例如 Life OS/Research/task.md（${OBSIDIAN_FOLDER_HINT}）`} value={obsidianForm.relativePath} onChange={event => setObsidianForm(current => ({ ...current, relativePath: event.target.value }))} />
            <Input className="h-9 text-xs" placeholder="标题" value={obsidianForm.title} onChange={event => setObsidianForm(current => ({ ...current, title: event.target.value }))} />
            <Textarea className="min-h-20 text-xs" placeholder="正文（用户已确认的增量内容）" value={obsidianForm.body} onChange={event => setObsidianForm(current => ({ ...current, body: event.target.value }))} />
            <Textarea className="min-h-16 text-xs" placeholder="引用（每行一项）" value={obsidianForm.citations} onChange={event => setObsidianForm(current => ({ ...current, citations: event.target.value }))} />
            <Button size="sm" variant="outline" disabled={busy || !obsidianForm.relativePath.trim() || !obsidianForm.title.trim() || !obsidianForm.body.trim()} onClick={() => void stageObsidian()}>暂存为待同步</Button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">vault 路径与文件系统权限仍在等待授权：本轮只提供接口与去重/冲突契约，服务端没有任何文件系统写入配置。</p>
      </div>
    </section>
  )
}
