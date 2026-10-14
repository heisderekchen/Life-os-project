import { expect, test } from '@playwright/test'

const fixtureTasks = Array.from({ length: 10 }, (_, index) => ({
  id: `mobile-fixture-${String(index + 1).padStart(2, '0')}`,
  title: `Mobile fixture task ${String(index + 1).padStart(2, '0')}`,
  description: `Fixture details ${index + 1}`,
  status: index === 0 ? 'in-progress' : 'todo',
  priority: 'medium',
  dueDate: null,
  startDate: null,
  completedAt: null,
  estimatedMinutes: null,
  actualMinutes: null,
  recurrence: null,
  recurrenceConfig: null,
  position: index,
  archived: false,
  createdAt: '2026-10-14T12:00:00.000Z',
  updatedAt: '2026-10-14T12:00:00.000Z',
  projectId: null,
  parentTaskId: null,
  tags: [],
  subtasks: [],
}))

test('mobile task queue uses the available height and scrolls normally at phone widths', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lifeos-app-store', JSON.stringify({
      state: {
        activeModule: 'tasks',
        welcomeSeen: true,
        setupComplete: true,
        language: 'en',
        enabledModules: ['dashboard', 'tasks', 'projects', 'notes', 'habits', 'journal', 'finance', 'goals', 'learning', 'calendar', 'time', 'settings'],
      },
      version: 0,
    }))
  })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.endsWith('/api/app-state')) {
      await route.fulfill({ json: {
        initialized: true,
        appInitialized: true,
        preferencesVersion: true,
        hasLifeOsData: true,
        setupComplete: true,
        revision: 'mobile-visual-fixture',
        preferences: {
          setupComplete: true,
          language: 'en',
          enabledModules: ['dashboard', 'tasks', 'projects', 'notes', 'habits', 'journal', 'finance', 'goals', 'learning', 'calendar', 'time', 'settings'],
          animationsEnabled: false,
        },
      } })
    } else if (path.endsWith('/api/tasks')) {
      await route.fulfill({ json: fixtureTasks })
    } else if (path.endsWith('/api/projects')) {
      await route.fulfill({ json: [] })
    } else if (path.endsWith('/api/recurring-tasks')) {
      await route.fulfill({ json: { series: [], activeCount: 0, schedulerEnabled: false } })
    } else {
      await route.fulfill({ json: {} })
    }
  })

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByText('Mobile fixture task 01', { exact: true })).toBeVisible()

    const list = page.locator('div.overflow-y-auto.overscroll-contain').filter({
      has: page.locator('[data-task-id="mobile-fixture-01"]'),
    }).first()
    await expect(list).toBeVisible()

    const metrics = await list.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const nav = document.querySelector('nav[aria-label="Primary navigation"]')?.getBoundingClientRect()
      const rows = [...element.querySelectorAll<HTMLElement>('[data-task-id]')]
      const visibleRows = rows.filter((row) => {
        const rowRect = row.getBoundingClientRect()
        return rowRect.top < rect.bottom && rowRect.bottom > rect.top
      }).length
      return {
        height: rect.height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollTop: element.scrollTop,
        visibleRows,
        listBottom: rect.bottom,
        navTop: nav?.top ?? window.innerHeight,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }
    })

    expect(metrics.height, `list height at ${width}px`).toBeGreaterThan(300)
    expect(metrics.visibleRows, `visible task rows at ${width}px`).toBeGreaterThanOrEqual(2)
    expect(metrics.listBottom, `list clears bottom navigation at ${width}px`).toBeLessThanOrEqual(metrics.navTop + 1)
    expect(metrics.documentWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.scrollHeight, `list has content to scroll at ${width}px`).toBeGreaterThan(metrics.clientHeight)

    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-top.png` })
    await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
    await expect(list.locator('[data-task-id="mobile-fixture-10"]')).toBeInViewport()
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-scrolled.png` })
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByText('Being worked on', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Add Task/i })).toBeVisible()
})
