import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Component tests do not compile production styles; browser acceptance covers CSS.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: true,
    exclude: ['deploy/standalone/fashion/test/**', '**/node_modules/**', '**/dist/**', '**/e2e/**', '**/agent-service/**', '**/.{idea,git,cache,output,temp}/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
