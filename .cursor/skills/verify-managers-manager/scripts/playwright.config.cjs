const path = require('node:path')
const root = path.resolve(__dirname, '../../../..')
const frontend = path.join(root, 'frontend')
// Playwright's config loader transforms the repository TypeScript config.
const base = require(path.join(frontend, 'playwright.config.ts')).default
const evidence = process.env.VERIFY_EVIDENCE
if (!evidence) throw new Error('Launch through verify.cjs run so evidence and port are isolated.')

module.exports = {
  ...base,
  testDir: path.join(frontend, 'e2e'),
  workers: 1,
  retries: 0,
  globalSetup: path.join(__dirname, 'doctor.cjs'),
  outputDir: path.join(evidence, 'test-results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(evidence, 'report') }],
    ['json', { outputFile: path.join(evidence, 'results.json') }],
  ],
  use: { ...base.use, baseURL: `http://127.0.0.1:${process.env.E2E_PORT}`, trace: 'on', screenshot: 'on' },
  webServer: {
    ...base.webServer,
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${process.env.E2E_PORT} --strictPort`,
    cwd: frontend,
    url: `http://127.0.0.1:${process.env.E2E_PORT}`,
    env: { VITE_ENABLE_MSW: 'true', VITE_API_BASE_URL: '', API_PROXY_TARGET: 'http://127.0.0.1:9' },
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
}
