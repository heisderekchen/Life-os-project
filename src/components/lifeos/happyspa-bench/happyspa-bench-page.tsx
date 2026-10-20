'use client'

import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, Clock3, Database, ShieldCheck } from 'lucide-react'
import { apiGet } from '@/lib/api/client'
import type { HappySpaBenchSnapshot } from '@/lib/happyspa-bench/contract'

const money = (fen: number | null) => fen === null ? '待确认' : `¥${(fen / 100).toFixed(2)}`
const stateLabel = (state: string) => state === 'fresh' ? '已确认' : state === 'stale' ? '已过期' : state === 'failed' ? '失败' : '待确认'

export function HappySpaBenchPage() {
  const snapshot = useQuery({
    queryKey: ['happyspa-bench', 'snapshot'],
    queryFn: () => apiGet<HappySpaBenchSnapshot>('/api/happyspa-bench/snapshot'),
    refetchInterval: 60_000,
  })
  const data = snapshot.data
  const max = data?.plan.accountDailyBudgetFen ?? 12000

  if (snapshot.isLoading) return <div className="mx-auto max-w-7xl p-5 text-sm text-muted-foreground">正在读取 HappyspaBench 只读快照…</div>
  if (snapshot.isError || !data) return <div className="mx-auto max-w-7xl p-5"><p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">快照不可用，未展示成功状态，也没有执行任何广告操作。</p></div>

  const cards = [
    ['今日额度', money(data.plan.accountDailyBudgetFen), '运营声明的全账户上限'],
    ['今日花费', money(data.live.official.todaySpendFen), `官方采集：${stateLabel(data.live.official.state)}`],
    ['剩余额度', data.live.official.todaySpendFen === null ? '待确认' : money(data.plan.accountDailyBudgetFen - data.live.official.todaySpendFen), '未确认不推算'],
    ['当前累计线', data.plan.intervals.at(-1)?.targetCumulativeFen ? money(data.plan.intervals.at(-1)!.targetCumulativeFen) : '待确认', '计划线，不是实际花费'],
  ]

  return <main className="mx-auto w-full max-w-7xl space-y-5 px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-7 sm:pt-5">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">myOS / HappyspaBench</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">极速推只读投放看板</h1><p className="mt-1 text-sm text-slate-600">任务 {data.taskId} · 同名标签 HappyspaBench · 北京时间</p></div>
      <span className="inline-flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800"><ShieldCheck className="h-4 w-4" />只读，不含广告控制</span>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="今日预算概览">{cards.map(([label, value, note]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></article>)}</section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,1fr)]">
      <article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-teal-700" /><h2 className="font-semibold text-slate-950">累计额度阶梯</h2></div><p className="mt-1 text-sm text-slate-600">虚线为可执行计划；没有确认的小时数据时，不伪造实际曲线。</p><div className="mt-5 space-y-4">{data.plan.intervals.map((slot, index) => <div key={slot.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm"><span className="text-slate-600">{slot.label}</span><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full border-r-2 border-dashed border-teal-700 bg-teal-100" style={{ width: `${Math.min(100, (slot.targetCumulativeFen / max) * 100)}%` }} /></div><span className="font-mono text-xs text-slate-700">¥{(slot.targetCumulativeFen / 100).toFixed(0)}{slot.stopped ? ' · 停' : ''}</span>{index === data.plan.intervals.length - 1 ? null : null}</div>)}</div><p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">前段未用额度允许顺延；平台 ¥200 上限不在本看板修改。</p></article>
      <aside className="rounded-xl border border-slate-200 p-4 text-white sm:p-5" style={{ backgroundColor: '#0f172a', color: '#fff' }}><h2 className="font-semibold">健康心跳与采集</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3 border-b border-white/10 pb-3"><dt className="text-slate-300">计划生效</dt><dd>{stateLabel(data.live.planEffective.state)}</dd></div><div className="flex justify-between gap-3 border-b border-white/10 pb-3"><dt className="text-slate-300">NEO 在线</dt><dd>{stateLabel(data.live.neo.state)}</dd></div><div className="flex justify-between gap-3 border-b border-white/10 pb-3"><dt className="text-slate-300">官方推广</dt><dd>{stateLabel(data.live.official.state)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-300">页面源截至</dt><dd>{data.live.official.sourceAsOf ?? '缺失'}</dd></div></dl><p className="mt-5 flex gap-2 rounded-lg bg-amber-400/15 p-3 text-xs leading-5 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />采集未接通时只显示待确认。轮询只读取快照，不会控制广告。</p></aside>
    </section>

    <section className="grid gap-5 lg:grid-cols-2"><article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="font-semibold text-slate-950">执行记录</h2><div className="mt-4 flex gap-3 text-sm"><Clock3 className="mt-0.5 h-4 w-4 text-teal-700" /><div><p className="font-medium text-slate-900">历史官方观察</p><p className="mt-1 text-slate-600">{data.historicalObservation.observedAt} · {data.historicalObservation.summary}</p></div></div><p className="mt-4 text-xs text-slate-500">无新的验收记录。历史观察与实时状态分开呈现。</p></article><article className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="font-semibold text-slate-950">方案依据与数据契约</h2><p className="mt-2 text-sm text-slate-600">{data.plan.planId} · {data.plan.planType} · 合约 {data.contractVersion}</p><div className="mt-4 flex items-start gap-3 text-sm text-slate-600"><Database className="mt-0.5 h-4 w-4 text-teal-700" /><p>接入状态：{data.integration === 'local_outbox_connected' ? '本地 outbox 已连接（仍按各项新鲜度显示）' : '本地 outbox 尚未连接'}。证据：{data.evidence.map(item => item.reference).join('；')}。日报预计结算与到账应分开，缺失小时数据保持空值。</p></div></article></section>
  </main>
}
