import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** E2E 시나리오 이름 (shared/mock/scenarios.ts 의 MOCK_SCENARIOS). M4 U1 다섯 개 + M5 회의 흐름 */
export type Scenario =
  | 'signed-out'
  | 'no-workspace'
  | 'single-workspace'
  | 'multiple-workspaces'
  | 'incomplete-workspace'
  | 'meeting-demo'
  | 'meeting-instant'
  | 'meeting-fail'
  | 'meeting-fail-notion-revoked'
  | 'meeting-notion-not-connected'
  | 'meeting-notion-revoked'
  | 'meeting-member'

/**
 * 모의 db 를 그 시나리오로 초기화하고 path 로 들어간다. 시나리오 파라미터는 저장값보다 앞서고
 * 주소에서 바로 지워진다 (browserDb.prepareBrowserDb). 테스트마다 새 컨텍스트라 sessionStorage 도 비어 있다.
 */
export async function start(page: Page, scenario: Scenario, path = '/'): Promise<void> {
  const url = new URL(path, 'http://placeholder')
  url.searchParams.set('msw-scenario', scenario)
  await page.goto(`${url.pathname}${url.search}`)
  await expect(page).not.toHaveURL(/msw-scenario/)
  // 개발 서버는 lazy 경로를 처음 요청받을 때 변환한다. 병렬 실행 부하에서 첫 화면이 기본 5초를 넘길 때가 있어
  // 앱이 뜰 때까지는 따로 기다린다 — 뒤의 단언은 기본 한도 그대로다 (F-r3)
  await expect(page.locator('#root main:not([aria-busy]), #root header').first()).toBeVisible({
    timeout: 15_000,
  })
}

/** 모의 OAuth 화면에서 결과를 골라 현재 탭으로 돌아온다 (D-158) */
export async function finishOAuth(
  page: Page,
  provider: '디스코드' | '노션',
  outcome: '연결 허용' | '취소' | '실패 재현' = '연결 허용',
): Promise<void> {
  await expect(page).toHaveURL(/\/__mock\/oauth\//)
  // 새 문서라 앱·MSW 가 처음부터 다시 뜬다 — 개발 서버가 바쁠 때 기본 5초를 넘길 때가 있다
  await expect(
    page.getByRole('heading', {
      name: `모의 ${provider === '디스코드' ? 'Discord' : 'Notion'} 연결`,
    }),
  ).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: outcome }).click()
  // 복귀도 새 문서다 — 앱이 다시 뜨고 연동 상태를 다시 조회한 뒤 단계를 저장해 주소가 바뀐다.
  // 개발 서버가 바쁠 때 기본 5초를 넘긴다. 복귀 표시가 주소에서 사라질 때까지만 따로 기다리고, 뒤의 단언은 기본 한도다
  await expect(page).not.toHaveURL(/oauth_result/, { timeout: 15_000 })
}

/** 가로 스크롤이 생기지 않았는지 — 1024px 이상 지원 (계획 1절) */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/**
 * 짧은 음원 픽스처 — 1초 · 8 kHz · 8비트 모노 PCM WAV(사인파 440 Hz), 8,044바이트.
 * 브라우저가 길이를 읽을 수 있어야 업로드 폼이 받는다(U3-4). 다시 만들 때는 RIFF 머리 44바이트 + 표본 8,000개다
 */
export const SHORT_AUDIO = {
  path: 'e2e/fixtures/short-meeting.wav',
  name: 'short-meeting.wav',
} as const

/** 회의 올리기에서 고른 파일의 길이를 브라우저가 읽을 때까지 기다린다 — 그 전에는 제출이 막혀 있다 */
export async function expectAudioReady(page: Page): Promise<void> {
  await expect(page.getByText(SHORT_AUDIO.name, { exact: true })).toBeVisible()
  // `00:01 · 0.1 MiB` 처럼 길이가 앞에 붙으면 받았다. 읽는 중은 `길이를 확인하고 있어요`
  await expect(page.getByText(/^\d+:\d{2} · /)).toBeVisible()
}
