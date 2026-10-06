import { defineConfig, devices } from '@playwright/test'

/*
 * Storybook 회귀 확인 (F-r1 #1). `storybook build` 산출물(storybook-static/)을 정적으로 띄워
 * 스토리를 순서대로 연다 — 스토리 handler 가 기본 handler 를 지우지 않는지, 앞 스토리가 뒤 스토리를 망치지 않는지 본다.
 * `npm run test:storybook` 이 빌드부터 한다. 앱 E2E(playwright.config.ts)와 서버·포트를 나누지 않는다.
 */
const PORT = Number(process.env.STORYBOOK_E2E_PORT ?? 6211)
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e/storybook',
  testMatch: '**/*.sb.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-storybook' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-storybook' }]],
  outputDir: 'test-results-storybook',
  // 막 빌드한 산출물의 첫 스토리는 큰 번들과 MSW worker 등록을 처음 거쳐 기본 5초를 넘길 때가 있다 (F-r3)
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 앱 E2E 와 같다 — 다시 돌릴 때만 기록한다 (playwright.config.ts)
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    // 빌드 산출물만 내보낸다(프록시 없음). 이미 떠 있는 서버는 재사용하지 않는다 (앱 E2E 와 같은 이유)
    command: `node e2e/storybook/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/iframe.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
