import { expect, test } from '@playwright/test'
const timestamp = '2026-10-14T12:00:00.000Z'
const fixtureTasks = Array.from({ length: 10 }, (_, index) => ({
  id: `mobile-fixture-${String(index + 1).padStart(2, '0')}`, title: `Mobile fixture task ${String(index + 1).padStart(2, '0')}`,
  description: `Fixture details ${index + 1}`, status: index === 0 ? 'in-progress' : index === 9 ? 'done' : 'todo',
  priority: 'medium', dueDate: index === 1 || index === 9 ? '2020-01-01' : null, startDate: null, completedAt: null,
  estimatedMinutes: null, actualMinutes: null, recurrence: null, recurrenceConfig: null, archived: false,
  createdAt: timestamp, updatedAt: timestamp, projectId: 'fixture-project', topicId: 'fixture-topic',
  sourceType: index === 0 ? 'Ongoing' : null, parentTaskId: null, tags: [], subtasks: [],
}))
test('unified workspace keeps filters, task rows and graph selection usable across phone and desktop widths', async ({ page }) => {
  const captureFocus = async (name: string) => {
    const screenshot = await page.screenshot({ path: `test-results/project-workspace-focus-${name}.png` })
    // Keep the synthetic visual evidence inspectable when artifact downloads are unavailable.
    if (process.env.CI) {
      const encoded = screenshot.toString('base64')
      for (let index = 0; index < encoded.length; index += 4096) console.log(`FOCUS_CAPTURE ${name} ${index} ${encoded.slice(index, index + 4096)}`)
    }
  }
  const state = { initialized: true, appInitialized: true, preferencesVersion: true, hasLifeOsData: true, setupComplete: true, revision: 'visual-fixture', preferences: { setupComplete: true, language: 'en', enabledModules: ['dashboard','tasks','projects','notes','calendar','settings'], animationsEnabled: false } }
  const project = { id: 'fixture-project', name: 'Fixture project', color: '#0f766e', status: 'active', createdAt: timestamp, updatedAt: timestamp }
  const topic = { id: 'fixture-topic', projectId: project.id, name: 'Fixture topic', createdAt: timestamp, updatedAt: timestamp }
  await page.addInitScript(({ state, tasks, project, topic }) => {
    localStorage.setItem('lifeos-app-store', JSON.stringify({ state: { activeModule: 'tasks', welcomeSeen: true, setupComplete: true, language: 'en', enabledModules: ['dashboard','tasks','projects','notes','calendar','settings'] }, version: 0 }))
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin).pathname
      const data = path.endsWith('/api/app-state') ? state : /\/api\/tasks\/[^/]+\/notes$/.test(path) ? { notes: [], nextCursor: null } : path.endsWith('/api/tasks') ? tasks : path.endsWith('/api/projects') ? [project] : path.endsWith('/api/topics') ? [topic] : path.endsWith('/api/recurring-tasks') ? { series: [], activeCount: 0, schedulerEnabled: false } : path.endsWith('/api/notifications') ? [] : path.endsWith('/api/profile') ? {} : path.endsWith('/api/platform/session') ? { principal: { role: 'user' } } : path.endsWith('/api/platform/workspaces') ? [] : undefined
      return data !== undefined ? Promise.resolve(new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })) : original(input, init)
    }
  }, { state, tasks: fixtureTasks, project, topic })
  const appPath = `${process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH || ''}/`
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(appPath)
    await expect(page.getByTestId('project-workspace')).toBeVisible()
    await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'List', exact: true }).click()
    if (await page.getByRole('button', { name: 'Flat list', exact: true }).count()) await page.getByRole('button', { name: 'Flat list', exact: true }).click()
    const filters = page.getByRole('group', { name: 'Task filters' })
    const rows = page.locator('[data-workspace-task]')
    await expect(rows).toHaveCount(10)
    for (const [name, count] of [[/^In progress\s*1$/, 1], [/^To do\s*8$/, 8], [/^Overdue\s*1$/, 1], [/^Completed\s*1$/, 1], [/^All\s*10$/, 10]] as const) {
      const filter = filters.getByRole('button', { name }); await filter.scrollIntoViewIfNeeded(); await filter.click(); await expect(rows).toHaveCount(count)
    }
    const search = page.getByRole('textbox', { name: 'Search projects, topics or tasks' })
    await search.fill('no matching record'); await expect(rows).toHaveCount(0)
    await search.fill(''); await expect(rows).toHaveCount(10)
    const scroll = page.locator('.workspace-table-scroll')
    const metrics = await scroll.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, width: document.documentElement.scrollWidth, viewport: innerWidth, bottom: element.getBoundingClientRect().bottom, nav: document.querySelector('nav[aria-label="Primary navigation"]')?.getBoundingClientRect().top || innerHeight }))
    expect(metrics.height).toBeGreaterThan(180); expect(metrics.scrollHeight).toBeGreaterThan(metrics.height)
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport); expect(metrics.bottom).toBeLessThanOrEqual(metrics.nav + 1)
    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-top.png` })
    await scroll.evaluate(element => element.scrollTo({ top: element.scrollHeight, left: element.scrollWidth, behavior: 'instant' }))
    await expect(rows.last()).toBeInViewport(); await expect(page.getByRole('columnheader', { name: 'Due date' })).toBeInViewport()
    await page.screenshot({ path: `test-results/mobile-task-queue-${width}-scrolled.png` })
  }
  await page.setViewportSize({ width: 1440, height: 960 }); await page.goto(appPath)
  await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'Linked', exact: true }).click()
  await page.getByRole('region', { name: 'Task list' }).getByRole('button', { name: /^Mobile fixture task 01/ }).click()
  await expect(page.getByRole('region', { name: 'Task summary' })).toBeVisible()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  await expect(page.locator('.react-flow__node.selected')).toContainText('Mobile fixture task 01')
  const graphTopic = page.getByRole('region', { name: 'Relationship graph', exact: true }).getByRole('button', { name: 'Fixture topic, 10 tasks', exact: true })
  await graphTopic.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Task list' }).getByRole('heading', { name: 'Fixture project / Fixture topic' })).toBeVisible()
  await page.getByRole('region', { name: 'Task list' }).getByRole('button', { name: /^Mobile fixture task 01/ }).click()
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/project-workspace-desktop-linked.png' })

  await page.getByRole('region', { name: 'Task list' }).getByRole('button', { name: /^Mobile fixture task 10/ }).click()
  await page.keyboard.press('F11')
  const workspace = page.getByTestId('project-workspace')
  await expect(workspace).toHaveAttribute('data-focus-mode', 'true')
  const focusControls = page.getByRole('toolbar', { name: 'Focus Mode', exact: true })
  await expect(focusControls).toBeVisible()
  const frame = await workspace.boundingBox(), controls = await focusControls.boundingBox()
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(frame!.y + 1)
  const graph = await page.getByRole('region', { name: 'Relationship graph', exact: true }).boundingBox()
  const list = await page.getByRole('region', { name: 'Task list' }).boundingBox()
  expect(list!.width).toBeGreaterThan(graph!.width * 1.5)
  expect(list!.height).toBeGreaterThan(960 * 0.65)
  const split = page.getByRole('separator', { name: 'Resize task list and details' })
  await expect(split).toHaveAttribute('aria-valuenow', '70')
  await captureFocus('desktop')
  await split.focus(); await page.keyboard.press('Home')
  const selected = page.locator('[data-workspace-node="task:mobile-fixture-10"]')
  const expectSelectionVisible = async () => {
    await expect.poll(async () => {
      const row = await selected.boundingBox()
      const viewport = await page.locator('.workspace-table-scroll').boundingBox()
      const header = await page.locator('.workspace-table thead').boundingBox()
      return Boolean(row && viewport && header && row.y >= header.y + header.height - 1 && row.y + row.height <= viewport.y + viewport.height + 1)
    }).toBe(true)
  }
  await expectSelectionVisible()
  await page.setViewportSize({ width: 1024, height: 650 })
  await expectSelectionVisible()
  await captureFocus('resized')
  await page.getByRole('group', { name: 'Workspace view' }).getByRole('button', { name: 'List', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expectSelectionVisible()
  await expect(selected).toBeInViewport()
  await split.dblclick()
  await expect(split).toHaveAttribute('aria-valuenow', '70')
  await expectSelectionVisible()
  await expect(page.getByRole('button', { name: /Exit Focus/ })).toBeVisible()
  await captureFocus('phone')
  await page.getByRole('button', { name: /Exit Focus/ }).click()
  await expect(workspace).not.toHaveAttribute('data-focus-mode', 'true')
  await expect(split).toHaveAttribute('aria-valuenow', '60')
})
