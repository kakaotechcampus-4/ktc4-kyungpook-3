import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const port = Number(process.env.CONSENT_E2E_PORT ?? 5213)
export default defineConfig({
  ...base,
  testMatch: '**/consent-published.spec.ts',
  workers: 2,
  retries: 0,
  use: { ...base.use, baseURL: `http://localhost:${port}`, trace: 'on' },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --config vite.consent.config.ts --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { VITE_ENABLE_MSW: 'true', VITE_API_BASE_URL: '', API_PROXY_TARGET: 'http://127.0.0.1:9' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
