import { defineConfig, devices } from '@playwright/test'

/*
 * 브라우저 E2E (M4 ⑤). MSW 는 개발 모드에서만 돌므로 Vite 개발 서버를 띄워 그 위에서 실행한다.
 * 테스트마다 새 브라우저 컨텍스트(빈 sessionStorage)에서 `?msw-scenario=` 로 모의 db 를 초기화한다 —
 * 서로 상태를 나누지 않아 병렬로 돌아도 된다. 개발 서버 포트(5173)와 겹치지 않게 따로 연다.
 *
 * 이미 떠 있는 서버를 재사용하지 않는다. Playwright 는 URL 이 응답하는지만 보므로, 같은 포트에 다른 worktree 의
 * 개발 서버가 떠 있으면 다른 코드로 E2E 가 통과해 버린다. 포트가 차 있으면 시작에 실패한다 —
 * 그때는 `E2E_PORT=5212 npm run test:e2e` 처럼 다른 포트를 준다.
 */
const PORT = Number(process.env.E2E_PORT ?? 5211)
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 실패한 테스트를 다시 돌릴 때만 trace 를 기록한다. CI(retries 1)가 아티팩트로 올린다. 로컬은 retries 0 이라
    // 기록하지 않는다 — 필요하면 `--trace on`. retain-on-failure 는 통과할 테스트도 매번 기록해 context 정리가
    // 30초 슬롯을 넘겼다 (2026-10-02, impl-decision/2026-09-29-storybook-e2e-setup.md)
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
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_ENABLE_MSW: 'true' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
