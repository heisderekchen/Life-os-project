import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const diagnostics: string[] = []
test.afterAll(() => writeFileSync('test-results/happyspa-bench-browser-diagnostics.txt', diagnostics.join('\n')))

function attachDiagnostics(page: Page) {
  page.on('pageerror', error => diagnostics.push(`pageerror: ${error.stack || error.message}`))
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`) })
  page.on('requestfailed', request => diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ''}`))
}

const snapshot = (state = 'pending_confirmation') => ({ contractVersion: '2026-10-20.v1', taskId: '499537ec-0aec-4a2e-8b1a-5526c9864d66', timezone: 'Asia/Shanghai', integration: 'local_outbox_not_connected', plan: { date: '2026-10-20', accountDailyBudgetFen: 12000, platformCapFen: 20000, planId: '极速推广20260512557', planType: '极速推', intervals: [{ label: '00:00–10:00', targetCumulativeFen: 0 }, { label: '10:00–12:00', targetCumulativeFen: 2500 }, { label: '12:00–15:00', targetCumulativeFen: 6500 }, { label: '15:00–18:00', targetCumulativeFen: 8000 }, { label: '18:00–21:00', targetCumulativeFen: 12000 }, { label: '21:00–24:00', targetCumulativeFen: 12000, stopped: true }] }, live: { official: { state, observedAt: null, sourceAsOf: null, todaySpendFen: null }, neo: { state: 'pending_confirmation', observedAt: null }, planEffective: { state: 'pending_confirmation', observedAt: null } }, historicalObservation: { observedAt: '2026-10-20T10:16:16+08:00', summary: 'S7.52，完整 9 个 running；仅历史观察，不代表当前状态。', sourceAsOf: null }, evidence: [] })

async function openBench(page: Page, state = 'pending_confirmation') {
  attachDiagnostics(page)
  await page.addInitScript(() => localStorage.setItem('lifeos-app-store', JSON.stringify({ state: { setupComplete: true, welcomeSeen: true, activeModule: 'happyspa-bench', language: 'zh', enabledModules: ['happyspa-bench'] }, version: 0 })))
  await page.route('**/api/app-state', route => route.fulfill({ json: { initialized: true, appInitialized: true, preferencesVersion: true, hasLifeOsData: true, setupComplete: true, revision: 'test', preferences: { language: 'zh', enabledModules: ['happyspa-bench'] } } }))
  await page.route('**/api/projects', route => route.fulfill({ json: [] }))
  await page.route('**/api/notifications', route => route.fulfill({ json: [] }))
  await page.route('**/api/profile', route => route.fulfill({ json: {} }))
  await page.route('**/api/platform/session', route => route.fulfill({ json: { principal: { role: 'member' } } }))
  await page.route('**/api/platform/workspaces', route => route.fulfill({ json: { workspaces: [] } }))
  await page.route('**/api/happyspa-bench/snapshot', route => route.fulfill({ json: snapshot(state) }))
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: '极速推只读投放看板' })).toBeVisible({ timeout: 15_000 })
}

test('renders unknown data and historical status without controls', async ({ page }, testInfo) => {
  await openBench(page)
  await expect(page.getByText('页面源截至').locator('..')).toContainText('缺失')
  await expect(page.getByText('仅历史观察，不代表当前状态。')).toBeVisible()
  await expect(page.getByRole('button', { name: /启动|暂停|恢复/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('happyspa-desktop-or-mobile.png'), fullPage: true })
})

test('renders stale state as stale', async ({ page }, testInfo) => {
  await openBench(page, 'stale')
  await expect(page.getByText('官方采集：已过期')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('happyspa-stale.png'), fullPage: true })
})
