import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Loaded here, before global setup and workers start, so src/lib/env.ts parses
// test values. Variables already set in the shell win.
process.loadEnvFile('.env.test')

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
  },
})
