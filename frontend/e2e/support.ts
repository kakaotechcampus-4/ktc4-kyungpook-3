import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** U1 의 E2E 시나리오 이름 (shared/mock/scenarios.ts 의 MOCK_SCENARIOS) */
export type Scenario =
  | 'signed-out'
  | 'no-workspace'
  | 'single-workspace'
  | 'multiple-workspaces'
  | 'incomplete-workspace'

/**
 * 모의 db 를 그 시나리오로 초기화하고 path 로 들어간다. 시나리오 파라미터는 저장값보다 앞서고
 * 주소에서 바로 지워진다 (browserDb.prepareBrowserDb). 테스트마다 새 컨텍스트라 sessionStorage 도 비어 있다.
 */
export async function start(page: Page, scenario: Scenario, path = '/'): Promise<void> {
  const url = new URL(path, 'http://placeholder')
  url.searchParams.set('msw-scenario', scenario)
  await page.goto(`${url.pathname}${url.search}`)
  await expect(page).not.toHaveURL(/msw-scenario/)
}

/** 모의 OAuth 화면에서 결과를 골라 현재 탭으로 돌아온다 (D-158) */
export async function finishOAuth(
  page: Page,
  provider: '디스코드' | '노션',
  outcome: '연결 허용' | '취소' | '실패 재현' = '연결 허용',
): Promise<void> {
  await expect(page).toHaveURL(/\/__mock\/oauth\//)
  await expect(
    page.getByRole('heading', {
      name: `모의 ${provider === '디스코드' ? 'Discord' : 'Notion'} 연결`,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: outcome }).click()
}

/** 가로 스크롤이 생기지 않았는지 — 1024px 이상 지원 (계획 1절) */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}
