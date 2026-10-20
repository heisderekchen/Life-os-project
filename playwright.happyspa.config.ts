import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: 'happyspa-bench.spec.ts', workers: 1, timeout: 60_000, reporter: 'list',
  use: { baseURL: 'http://localhost:3012', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: { command: 'NEXT_TELEMETRY_DISABLED=1 /tmp/bun-v1.3.4/bun-darwin-aarch64/bun run dev -- --port 3012', url: 'http://localhost:3012', reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe' },
})
