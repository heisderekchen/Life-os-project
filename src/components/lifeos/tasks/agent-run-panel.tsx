'use client'

import { useEffect, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api/client'

type AgentRun = {
  id: string
  state: string
  version: number
  provider: 'deepseek' | 'openai'
  model: string
  budgetUsd: number
  maxOutputTokens: number
  request: { prompt: string }
  approvalFingerprint?: string | null
  result?: unknown
  errorCode?: string | null
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiPath(`/api/agent${path}`), {
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    cache: 'no-store',
  })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || value.reason || `HTTP_${response.status}`)
  return value as T
}

function promptForTask(task: { title: string; description: string }) {
  return `请为以下个人任务给出可执行的分步计划，并以 JSON 格式返回 summary 和 drafts。\n任务：${task.title}\n详情：${task.description}`
}

export function AgentRunPanel({ task }: { task: { id: string; title: string; description: string } }) {
  const [health, setHealth] = useState<any>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [provider, setProvider] = useState<'deepseek' | 'openai'>('deepseek')
  const [prompt, setPrompt] = useState(() => promptForTask(task))
  const [approved, setApproved] = useState(false)
  const [confirmedOpenAI, setConfirmedOpenAI] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useMemo(() => runs.find(run => ['queued', 'running', 'cancel_requested'].includes(run.state)), [runs])

  async function refresh() {
    try {
      const h = await call<any>('/health')
      setHealth(h)
      if (!h.enabled) { setRuns([]); return }
      const list = await call<{ runs: AgentRun[] }>('/runs?limit=10')
      setRuns(list.runs || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'SERVICE_UNAVAILABLE') }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => { setPrompt(promptForTask(task)); setApproved(false) }, [task.id, task.title, task.description])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [active?.id])

  async function createDraft() {
    setBusy(true); setError('')
    try {
      const result = await call<{ run: AgentRun; approvalFingerprint: string }>('/runs', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ prompt: prompt.trim(), provider, budgetUsd: 0.1, maxOutputTokens: 800 }),
      })
      setRuns(current => [{ ...result.run, approvalFingerprint: result.approvalFingerprint }, ...current.filter(run => run.id !== result.run.id)])
      setApproved(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'REQUEST_FAILED') }
    finally { setBusy(false) }
  }

  async function approveRun(run: AgentRun) {
    setBusy(true); setError('')
    try {
      await call(`/runs/${run.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ version: run.version, approvalFingerprint: run.approvalFingerprint, confirmedOpenAI }),
      })
      setApproved(false); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'APPROVAL_FAILED') }
    finally { setBusy(false) }
  }

  const ready = health?.enabled && health?.taskTrigger === 'approved_worker' && health?.providers?.[provider]
  const currentDraft = runs.find(run => run.state === 'draft')
  return <section className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5" aria-label="AI task planner">
    <div><h4 className="text-sm font-semibold">AI 任务规划</h4><p className="mt-1 text-xs text-muted-foreground">只发送你在下方确认的任务文字；不会读取门店客户、订单或其他 Life OS 数据。AI 只返回建议，不会自动改动任务。</p></div>
    {!health?.enabled && <p className="text-xs text-muted-foreground">AI 服务未启用：{health?.reason || error || '等待健康检查'}</p>}
    {health?.enabled && health?.taskTrigger !== 'approved_worker' && <p className="text-xs text-muted-foreground">执行 worker 尚未就绪，当前不能批准执行。</p>}
    <label className="block text-xs">模型提供方<select className="mt-1 w-full rounded-md border bg-background p-2" value={provider} onChange={e => setProvider(e.target.value as 'deepseek' | 'openai')}><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label>
    <textarea className="min-h-28 w-full rounded-md border bg-background p-2 text-sm" maxLength={20000} value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="发送给 AI 的任务内容" />
    <p className="text-xs text-muted-foreground">每次最多 $0.10；最多生成 800 tokens。需先创建草稿，再单独批准才会调用模型。</p>
    <button type="button" disabled={!ready || busy || active != null || !prompt.trim()} onClick={() => void createDraft()} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">创建审批草稿</button>
    {currentDraft && <div className="space-y-2 rounded-md border p-3"><p className="text-xs font-medium">待审批 · {currentDraft.provider} / {currentDraft.model} · ${Number(currentDraft.budgetUsd).toFixed(2)} · {currentDraft.maxOutputTokens} tokens</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{currentDraft.request.prompt}</pre><label className="flex gap-2 text-xs"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />我已核对上方完整提示词和额度，并明确批准调用模型。</label>{currentDraft.provider === 'openai' && <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmedOpenAI} onChange={e => setConfirmedOpenAI(e.target.checked)} />我确认将任务内容发送至 OpenAI。</label>}<button type="button" disabled={!approved || (currentDraft.provider === 'openai' && !confirmedOpenAI) || !ready || busy} onClick={() => void approveRun(currentDraft)} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">批准并排队执行</button></div>}
    {runs.filter(run => run.state !== 'draft').slice(0, 4).map(run => <div key={run.id} className="rounded-md border p-2 text-xs"><p>执行状态：{run.state}{run.errorCode ? ` · ${run.errorCode}` : ''}</p>{run.result && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(run.result, null, 2)}</pre>}</div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>
}
