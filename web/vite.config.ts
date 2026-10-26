/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Page tests render real Ant Design forms in jsdom: 2–8 s locally and
    // roughly twice that on CI runners, so the 5 s default makes them flaky.
    testTimeout: 20_000,
  },
})
