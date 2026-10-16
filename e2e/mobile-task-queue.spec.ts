import { expect, test } from '@playwright/test'

const fixtureTasks = Array.from({ length: 10 }, (_, index) => ({
  id: `mobile-fixture-${String(index + 1).padStart(2, '0')}`,
  title: `Mobile fixture task ${String(index + 1).padStart(2, '0')}`,
  description: `Fixture details ${index + 1}`,
  status: index === 0 ? 'in-progress' : index === 9 ? 'done' : 'todo',
  priority: 'medium',
  dueDate: index === 1 || index === 9 ? '2020-01-01' : null,
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
  sourceType: index === 0 ? 'Ongoing' : null,
  parentTaskId: null,
  tags: [],
  subtasks: [],
}))

test('mobile task queue uses the available height and scrolls normally at phone widths', async ({ page }) => {
  const cloudState = {
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
  }

  await page.addInitScript(() => {
    try {
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
    } catch {}
  })

  await page.addInitScript(({ state, tasks }) => {
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = new URL(requestUrl, window.location.origin).pathname
      let payload: unknown
      if (path.endsWith('/api/app-state')) payload = state
      else if (path.endsWith('/api/tasks')) payload = tasks
      else if (path.endsWith('/api/projects')) payload = []
      else if (path.endsWith('/api/recurring-tasks')) payload = { series: [], activeCount: 0, schedulerEnabled: false }
      else if (path.endsWith('/api/notifications')) payload = []
      else if (path.endsWith('/api/profile')) payload = {}
      else if (path.endsWith('/api/platform/session')) payload = { principal: { role: 'user' } }
      else if (path.endsWith('/api/platform/workspaces')) payload = []
      if (payload !== undefined) {
        return Promise.resolve(new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return realFetch(input, init)
    }
  }, { state: cloudState, tasks: fixtureTasks })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    console.log(`mobile fixture API: ${route.request().method()} ${path}`)
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

  const appPath = process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH
    ? `${process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH.replace(/\/$/, '')}/`
    : '/'

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(appPath)
    console.log(`mobile fixture page: ${page.url()} width=${width}`)
    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-diagnostic.png` })
    console.log(`mobile fixture page text: ${(await page.locator('body').innerText()).slice(0, 1800)}`)
    await expect(page.getByText('Mobile fixture task 01', { exact: true })).toBeVisible()
    const filters = page.getByRole('group', { name: 'Task filters' })
    const allFilter = filters.getByRole('button', { name: /^All\s*10$/ })
    const activeFilter = filters.getByRole('button', { name: /^In progress\s*1$/ })
    const todoFilter = filters.getByRole('button', { name: /^To do\s*8$/ })
    const overdueFilter = filters.getByRole('button', { name: /^Overdue\s*1$/ })
    const completedFilter = filters.getByRole('button', { name: /^Completed\s*1$/ })
    const taskRows = page.locator('article[data-task-id]')
    await expect(allFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(taskRows).toHaveCount(10)
    await expect(page.locator('[data-task-id="mobile-fixture-01"]').getByText('Ongoing', { exact: true })).toBeVisible()

    // Filters may scroll within their own strip at narrow widths, but their
    // labels must stay intact and each control must remain reachable.
    for (const filter of [allFilter, activeFilter, todoFilter, overdueFilter, completedFilter]) {
      await filter.scrollIntoViewIfNeeded()
      await expect(filter).toBeInViewport()
      expect(await filter.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
        `no truncated filter label at ${width}px`).toBe(true)
    }
    await activeFilter.click()
    await expect(activeFilter).toHaveAttribute('aria-pressed', 'true')
    await expect(taskRows).toHaveCount(1)
    await expect(taskRows.first()).toHaveAttribute('data-task-id', 'mobile-fixture-01')
    await todoFilter.click()
    await expect(taskRows).toHaveCount(8)
    await expect(page.locator('[data-task-id="mobile-fixture-02"]')).toBeVisible()
    await overdueFilter.click()
    await expect(taskRows).toHaveCount(1)
    await expect(taskRows.first()).toHaveAttribute('data-task-id', 'mobile-fixture-02')
    await completedFilter.click()
    await expect(taskRows).toHaveCount(1)
    await expect(taskRows.first()).toHaveAttribute('data-task-id', 'mobile-fixture-10')
    await allFilter.click()
    await expect(taskRows).toHaveCount(10)
    const search = page.getByRole('textbox', { name: 'Search tasks' })
    await search.fill('no matching task')
    await expect(taskRows).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await expect(taskRows).toHaveCount(10)
    await expect(allFilter).toHaveAttribute('aria-pressed', 'true')

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
      const fullyVisibleRows = rows.filter(row => {
        const rowRect = row.getBoundingClientRect()
        return rowRect.top >= rect.top && rowRect.bottom <= rect.bottom
      }).length
      return {
        height: rect.height,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollTop: element.scrollTop,
        visibleRows,
        fullyVisibleRows,
        rowHeight: rows[0]?.getBoundingClientRect().height ?? 0,
        listBottom: rect.bottom,
        navTop: nav?.top ?? window.innerHeight,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }
    })

    expect(metrics.height, `list height at ${width}px`).toBeGreaterThan(300)
    expect(metrics.fullyVisibleRows, `complete task rows at ${width}px`).toBeGreaterThanOrEqual(4)
    expect(metrics.rowHeight, `compact two-line row at ${width}px`).toBeLessThanOrEqual(90)
    expect(metrics.listBottom, `list clears bottom navigation at ${width}px`).toBeLessThanOrEqual(metrics.navTop + 1)
    expect(metrics.documentWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewportWidth)
    expect(metrics.scrollHeight, `list has content to scroll at ${width}px`).toBeGreaterThan(metrics.clientHeight)
    console.log(`mobile viewport ${width}px layout metrics: ${JSON.stringify(metrics)}`)

    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-top.png` })
    await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
    await expect(list.locator('[data-task-id="mobile-fixture-10"]')).toBeInViewport()
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-scrolled.png` })
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(appPath)
  await expect(page.getByRole('group', { name: 'Task filters' }).getByRole('button', { name: /^In progress\s*1$/ })).toBeVisible()
  await expect(page.locator('article[data-task-id]')).toHaveCount(10)
  await expect(page.getByText('Being worked on', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Add Task/i })).toBeVisible()
})
