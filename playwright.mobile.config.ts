import { defineConfig } from '@playwright/test'

const basePath = process.env.NEXT_PUBLIC_LIFEOS_BASE_PATH || ''

export default defineConfig({
  testDir: './e2e',
  testMatch: 'mobile-task-queue.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:3000${basePath}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    url: `http://127.0.0.1:3000${basePath}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
