'use client'

// MVP task-card + Worker-routing view for the current Life OS task detail.
// It reads and writes only the standalone task-card API (same origin, base
// path aware) and never calls a model provider: routing is configuration.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type ProviderEntry = { provider: string; label: string; model: string; ready: boolean; reason: string | null }
type UnavailableEntry = { provider: string; label: string; available: boolean; message: string }
type WorkerRole = 'planner' | 'developer' | 'reviewer'
type RoleAssignment = { role: WorkerRole; provider: string | null; model: string | null; objective?: string }
type RoutingRow = { type: string; role: string; provider: string; model: string; ready: boolean }

export type TaskCard = {
  taskId: string
  type: string
  goal: string
  expectedArtifacts: string[]
  subtaskIds: string[]
  dependencyIds: string[]
  roles: RoleAssignment[]
  verification: string[]
  nextStep: string
  status: string
  updatedAt: string
}

type CatalogResponse = {
  catalog: { providers: ProviderEntry[]; unavailable: UnavailableEntry[]; readyCount: number; agentServiceReachable: boolean }
  types: { id: string; label: string }[]
  roles: { id: string; label: string }[]
  statuses: { id: string; label: string }[]
  routing: RoutingRow[]
}

export type CardResponse = { taskId: string; card: TaskCard | null; routing: RoutingRow[] }
type TaskDetail = {
  subtasks?: { id: string; title: string }[]
  dependencies?: { id: string; dependsOnId: string; dependsOn?: { title?: string } | null }[]
}

type CardForm = {
  type: string
  goal: string
  expectedArtifacts: string
  subtaskIds: string[]
  dependencyIds: string[]
  roles: Record<WorkerRole, RoleFormValue>
  verification: string
  nextStep: string
  status: string
}

type RefOption = { id: string; title: string }
type RoleFormValue = { provider: string; model: string; objective: string }

const ROLE_IDS: WorkerRole[] = ['planner', 'developer', 'reviewer']
const FALLBACK_TYPES = [
  { id: 'bug', label: 'Bug' },
  { id: 'optimization', label: '优化' },
  { id: 'new_feature', label: '新需求' },
  { id: 'environment', label: '环境' },
  { id: 'test', label: '测试' },
]
const FALLBACK_ROLES = [
  { id: 'planner', label: '规划' },
  { id: 'developer', label: '开发' },
  { id: 'reviewer', label: '复核' },
]
const FALLBACK_STATUSES = [
  { id: 'draft', label: '草稿' },
  { id: 'ready', label: '就绪' },
  { id: 'done', label: '完成' },
]

const emptyForm = (): CardForm => ({
  type: 'bug',
  goal: '',
  expectedArtifacts: '',
  subtaskIds: [],
  dependencyIds: [],
  roles: {
    planner: { provider: '', model: '', objective: '' },
    developer: { provider: '', model: '', objective: '' },
    reviewer: { provider: '', model: '', objective: '' },
  },
  verification: '',
  nextStep: '',
  status: 'draft',
})

const linesOf = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)

function formOf(card: TaskCard): CardForm {
  const form = emptyForm()
  form.type = card.type
  form.goal = card.goal
  form.expectedArtifacts = card.expectedArtifacts.join('\n')
  form.subtaskIds = [...card.subtaskIds]
  form.dependencyIds = [...card.dependencyIds]
  form.verification = card.verification.join('\n')
  form.nextStep = card.nextStep || ''
  form.status = card.status
  for (const assignment of card.roles || []) {
    if (!ROLE_IDS.includes(assignment.role)) continue
    form.roles[assignment.role] = {
      provider: assignment.provider || '',
      model: assignment.model || '',
      objective: assignment.objective || '',
    }
  }
  return form
}

export async function fetchTaskCard(taskId: string): Promise<TaskCard | null> {
  const response = await fetch(apiPath(`/api/task-cards/tasks/${encodeURIComponent(taskId)}`), { cache: 'no-store' })
  const value = await response.json().catch(() => ({})) as CardResponse & { error?: string }
  if (!response.ok) throw new Error(value.error || `HTTP_${response.status}`)
  return value.card
}

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

export function TaskCardPanel({ taskId }: { taskId: string }) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)
  const [types, setTypes] = useState(FALLBACK_TYPES)
  const [roleLabels, setRoleLabels] = useState(FALLBACK_ROLES)
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES)
  const [saved, setSaved] = useState<TaskCard | null>(null)
  const [routing, setRouting] = useState<RoutingRow[]>([])
  const [form, setForm] = useState<CardForm>(emptyForm)
  const [draft, setDraft] = useState<Partial<Record<WorkerRole, string>>>({})
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [subtasks, setSubtasks] = useState<RefOption[]>([])
  const [dependencies, setDependencies] = useState<RefOption[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [catalogResponse, cardResponse, detail] = await Promise.all([
        call<CatalogResponse>('/api/task-cards/catalog'),
        call<CardResponse>(`/api/task-cards/tasks/${encodeURIComponent(taskId)}`),
        call<TaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`).catch((): TaskDetail => ({})),
      ])
      // Routing edits need the current platform-admin policy; the server
      // re-checks it on every write anyway. This path is the same origin root,
      // not the /workbench base path.
      const session = await fetch('/api/platform/session', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .catch(() => null)
      setIsPlatformAdmin(session?.principal?.role === 'platform_admin')
      setCatalog(catalogResponse)
      if (catalogResponse.types?.length) setTypes(catalogResponse.types)
      if (catalogResponse.roles?.length) setRoleLabels(catalogResponse.roles)
      if (catalogResponse.statuses?.length) setStatuses(catalogResponse.statuses)
      setRouting(cardResponse.routing?.length ? cardResponse.routing : catalogResponse.routing || [])
      setSubtasks((detail.subtasks || []).map(task => ({ id: task.id, title: task.title })))
      setDependencies((detail.dependencies || []).map(link => ({
        id: link.id, title: link.dependsOn?.title || link.dependsOnId,
      })))
      setSaved(cardResponse.card)
      setForm(cardResponse.card ? formOf(cardResponse.card) : emptyForm())
      setEditing(!cardResponse.card)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'TASK_CARD_LOAD_FAILED')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { void refresh() }, [refresh])

  const providers = catalog?.catalog.providers || []
  const readyProviders = useMemo(() => providers.filter(entry => entry.ready), [providers])
  const unavailable = catalog?.catalog.unavailable || []
  const typeLabel = (id: string) => types.find(entry => entry.id === id)?.label || id
  const roleLabel = (id: string) => roleLabels.find(entry => entry.id === id)?.label || id
  const statusLabel = (id: string) => statuses.find(entry => entry.id === id)?.label || id

  const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter(value => value !== id) : [...list, id])

  const toggleRef = (key: 'subtaskIds' | 'dependencyIds', id: string) => {
    setForm(current => (key === 'subtaskIds'
      ? { ...current, subtaskIds: toggleId(current.subtaskIds, id) }
      : { ...current, dependencyIds: toggleId(current.dependencyIds, id) }))
  }

  const setRole = (role: WorkerRole, patch: Partial<RoleFormValue>) => {
    setForm(current => {
      const roles: Record<WorkerRole, RoleFormValue> = { ...current.roles }
      roles[role] = { ...roles[role], ...patch }
      return { ...current, roles }
    })
  }

  const setDraftValue = (role: WorkerRole, value: string) => {
    setDraft(previous => {
      const next = { ...previous }
      next[role] = value
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        type: form.type,
        goal: form.goal.trim(),
        status: form.status,
        expectedArtifacts: linesOf(form.expectedArtifacts),
        subtaskIds: form.subtaskIds,
        dependencyIds: form.dependencyIds,
        verification: linesOf(form.verification),
        nextStep: form.nextStep.trim(),
        roles: ROLE_IDS.map(role => ({
          role,
          provider: form.roles[role].provider || null,
          model: form.roles[role].model || null,
          objective: form.roles[role].objective.trim(),
        })),
      }
      const response = await call<{ card: TaskCard }>(`/api/task-cards/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PUT', body: JSON.stringify(payload),
      })
      setSaved(response.card)
      setForm(formOf(response.card))
      setEditing(false)
      setNotice('任务卡已保存')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'TASK_CARD_SAVE_FAILED')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await call(`/api/task-cards/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
      setSaved(null)
      setForm(emptyForm())
      setEditing(true)
      setNotice('任务卡已删除')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'TASK_CARD_DELETE_FAILED')
    } finally {
      setBusy(false)
    }
  }

  const routingFor = (type: string, role: string) => routing.find(entry => entry.type === type && entry.role === role)

  const saveRouting = async (role: WorkerRole) => {
    const current = routingFor(form.type, role)
    const value = draft[role] !== undefined ? draft[role] : current ? `${current.provider}|${current.model}` : ''
    if (!value) return
    const [provider, model] = value.split('|')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await call('/api/task-cards/routing', { method: 'PUT', body: JSON.stringify({ type: form.type, role, provider, model }) })
      setDraftValue(role, value)
      setNotice('Worker 路由已更新')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ROUTING_SAVE_FAILED')
    } finally {
      setBusy(false)
    }
  }

  const clearRouting = async (role: WorkerRole) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await call(`/api/task-cards/routing?type=${encodeURIComponent(form.type)}&role=${encodeURIComponent(role)}`, { method: 'DELETE' })
      setDraftValue(role, '')
      setNotice('Worker 路由已清除')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ROUTING_DELETE_FAILED')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5" aria-label="任务卡与 Worker 路由">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">任务卡</h4>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium">任务编号</span>
            <span className="min-w-0 break-all font-mono text-[11px] leading-5 text-foreground/70" title={taskId}>{taskId}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            类型、目标、预期产出、现有子任务/依赖、三角色分配、验证证据与下一步。仅保存在本工作区，不会调用模型。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <Badge variant="outline" className="text-xs">{statusLabel(saved.status)}</Badge>}
          {saved && <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(current => !current)}>{editing ? '查看' : '编辑'}</Button>}
        </div>
      </div>

      {loading && <p className="text-xs text-muted-foreground">正在读取任务卡…</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {!loading && !editing && saved && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">类型</p>
              <p className="text-sm">{typeLabel(saved.type)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">状态</p>
              <p className="text-sm">{statusLabel(saved.status)}</p>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">目标</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{saved.goal}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">预期产出</p>
            {saved.expectedArtifacts.length
              ? <ul className="list-disc space-y-1 pl-5 text-sm">{saved.expectedArtifacts.map(item => <li key={item} className="break-words">{item}</li>)}</ul>
              : <p className="text-sm text-muted-foreground">未填写</p>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">现有子任务</p>
              {saved.subtaskIds.length
                ? <div className="flex flex-wrap gap-1.5">{saved.subtaskIds.map(id => <Badge key={id} variant="secondary" className="max-w-full truncate text-xs">{subtasks.find(option => option.id === id)?.title || id}</Badge>)}</div>
                : <p className="text-sm text-muted-foreground">未关联</p>}
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">现有依赖</p>
              {saved.dependencyIds.length
                ? <div className="flex flex-wrap gap-1.5">{saved.dependencyIds.map(id => <Badge key={id} variant="secondary" className="max-w-full truncate text-xs">{dependencies.find(option => option.id === id)?.title || id}</Badge>)}</div>
                : <p className="text-sm text-muted-foreground">未关联</p>}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">角色分配</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {ROLE_IDS.map(role => {
                const assignment = saved.roles?.find(entry => entry.role === role)
                const fallback = routingFor(saved.type, role)
                const worker = assignment?.provider && assignment?.model
                  ? `${assignment.provider} / ${assignment.model}`
                  : fallback ? `${fallback.provider} / ${fallback.model}（路由默认）` : null
                return (
                  <div key={role} className="rounded-md border border-border/60 p-2">
                    <p className="text-xs font-medium">{roleLabel(role)}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{worker || '未指派'}</p>
                    {assignment?.objective && <p className="mt-1 break-words text-xs">{assignment.objective}</p>}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">验证证据</p>
            {saved.verification.length
              ? <ul className="list-disc space-y-1 pl-5 text-sm">{saved.verification.map(item => <li key={item} className="break-words">{item}</li>)}</ul>
              : <p className="text-sm text-muted-foreground">尚未记录</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">下一步</p>
            <p className="whitespace-pre-wrap break-words text-sm">{saved.nextStep || '未填写'}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">最近更新：{saved.updatedAt ? new Date(saved.updatedAt).toLocaleString('zh-CN') : '—'}</p>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void remove()}>删除任务卡</Button>
        </div>
      )}

      {!loading && editing && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="text-muted-foreground">类型</span>
              <select className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={form.type} onChange={event => setForm(current => ({ ...current, type: event.target.value }))}>
                {types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-muted-foreground">状态</span>
              <select className="mt-1 w-full rounded-md border bg-background p-2 text-sm" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>
                {statuses.map(status => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">目标</span>
            <Textarea className="mt-1 min-h-20 text-sm" value={form.goal} maxLength={2000} aria-label="任务卡目标" onChange={event => setForm(current => ({ ...current, goal: event.target.value }))} />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">预期产出（每行一项）</span>
            <Textarea className="mt-1 min-h-20 text-sm" value={form.expectedArtifacts} aria-label="预期产出" onChange={event => setForm(current => ({ ...current, expectedArtifacts: event.target.value }))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">现有子任务</p>
              {subtasks.length === 0 && <p className="text-xs text-muted-foreground">该任务暂无子任务</p>}
              {subtasks.map(option => (
                <label key={option.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.subtaskIds.includes(option.id)} onChange={() => toggleRef('subtaskIds', option.id)} />
                  <span className="break-words">{option.title}</span>
                </label>
              ))}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">现有依赖</p>
              {dependencies.length === 0 && <p className="text-xs text-muted-foreground">该任务暂无依赖</p>}
              {dependencies.map(option => (
                <label key={option.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.dependencyIds.includes(option.id)} onChange={() => toggleRef('dependencyIds', option.id)} />
                  <span className="break-words">{option.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">三角色分配（可选，只能使用服务端目录中已就绪的模型）</p>
            {ROLE_IDS.map(role => (
              <div key={role} className="grid gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-3">
                <p className="text-xs font-medium">{roleLabel(role)}</p>
                <select
                  className="rounded-md border bg-background p-2 text-xs"
                  aria-label={`${roleLabel(role)}模型`}
                  value={form.roles[role].provider ? `${form.roles[role].provider}|${form.roles[role].model}` : ''}
                  onChange={event => {
                    const [provider = '', model = ''] = event.target.value.split('|')
                    setRole(role, { provider, model })
                  }}
                >
                  <option value="">未指派</option>
                  {readyProviders.map(entry => <option key={entry.provider} value={`${entry.provider}|${entry.model}`}>{entry.label} · {entry.model}</option>)}
                </select>
                <Input className="h-8 text-xs" placeholder="该角色的分工说明（可选）" value={form.roles[role].objective} onChange={event => setRole(role, { objective: event.target.value })} />
              </div>
            ))}
            {readyProviders.length === 0 && <p className="text-xs text-muted-foreground">当前没有已配置且就绪的模型，角色可以留空。</p>}
          </div>
          <label className="block text-xs">
            <span className="text-muted-foreground">验证证据（每行一项）</span>
            <Textarea className="mt-1 min-h-20 text-sm" value={form.verification} aria-label="验证证据" onChange={event => setForm(current => ({ ...current, verification: event.target.value }))} />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">下一步</span>
            <Input className="mt-1 h-9 text-sm" value={form.nextStep} maxLength={500} onChange={event => setForm(current => ({ ...current, nextStep: event.target.value }))} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !form.goal.trim()} onClick={() => void save()}>{busy ? '正在保存…' : '保存任务卡'}</Button>
            {saved && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setForm(formOf(saved)); setEditing(false) }}>取消</Button>}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
        <p className="text-xs font-medium">Worker 路由</p>
        {routing.length === 0 && <p className="text-xs text-muted-foreground">平台管理员尚未为任何「任务类型 + 角色」配置 Worker。</p>}
        {routing.map(entry => (
          <p key={`${entry.type}|${entry.role}`} className="text-xs text-muted-foreground">
            {typeLabel(entry.type)} · {roleLabel(entry.role)} → {entry.provider} / {entry.model}{entry.ready ? '' : '（当前未就绪）'}
          </p>
        ))}
        {providers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            可用模型：{readyProviders.length ? readyProviders.map(entry => `${entry.label} · ${entry.model}`).join('、') : '暂无'}
          </p>
        )}
        {unavailable.map(entry => <p key={entry.provider} className="text-xs text-muted-foreground">{entry.label}：不可用（{entry.message}）</p>)}
        <p className="text-[10px] text-muted-foreground">路由只能由平台管理员在服务端目录范围内修改；此界面不会调用模型。</p>
        {isPlatformAdmin && (
          <div className="space-y-2 rounded-md border border-border/60 p-2">
            <p className="text-xs font-medium">配置「{typeLabel(form.type)}」的 Worker 路由（仅平台管理员）</p>
            {ROLE_IDS.map(role => {
              const current = routingFor(form.type, role)
              const value = draft[role] !== undefined ? draft[role] : current ? `${current.provider}|${current.model}` : ''
              return (
                <div key={role} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <span className="text-xs sm:w-12">{roleLabel(role)}</span>
                  <select
                    className="min-w-0 flex-1 rounded-md border bg-background p-2 text-xs"
                    aria-label={`${roleLabel(role)}路由`}
                    value={value}
                    onChange={event => setDraftValue(role, event.target.value)}
                  >
                    <option value="">未配置</option>
                    {readyProviders.map(entry => <option key={entry.provider} value={`${entry.provider}|${entry.model}`}>{entry.label} · {entry.model}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-8" disabled={busy || !value} onClick={() => void saveRouting(role)}>保存</Button>
                    {current && <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" disabled={busy} onClick={() => void clearRouting(role)}>清除</Button>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
