import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

/** E2E 시나리오 이름 (shared/mock/scenarios.ts 의 MOCK_SCENARIOS). M4 U1 다섯 개 + M5 회의 흐름 + M6 태스크·승인 + M7 대시보드 + M8 태스크 보기·설정 + #320 팀원 초대 + #256 화자 지정 + #370 재촉 만들기 + #371 메시지 + #411 알림 띠 + #419 수정 제안 + #482 메시지 긴 문구 + #457 로그인 시도 제한 */
export type Scenario =
  | 'policy-reconsent'
  | 'consent-required'
  | 'consent-signup'
  | 'consent-agreed'
  | 'consent-mismatch'
  | 'consent-read-error'
  | 'consent-write-error'
  | 'consent-response-lost'
  | 'signed-out'
  | 'no-workspace'
  | 'single-workspace'
  | 'multiple-workspaces'
  | 'incomplete-workspace'
  | 'meeting-demo'
  | 'meeting-instant'
  | 'meeting-fail'
  | 'meeting-fail-diarize'
  | 'meeting-fail-expired'
  | 'meeting-fail-unclaimed'
  | 'meeting-expired-member'
  | 'meeting-notion-not-connected'
  | 'meeting-member'
  | 'meeting-chat-processing'
  | 'meeting-chat-stalled'
  | 'meeting-chat-demo'
  | 'meeting-speakers'
  | 'meeting-speakers-member'
  | 'meeting-speakers-expired'
  | 'tasks-default'
  | 'tasks-empty'
  | 'approval-needs-input'
  | 'approval-rejected'
  | 'approval-resolved'
  | 'approval-conflict'
  | 'approval-scope'
  | 'approval-asr-suspects-long'
  | 'minutes-edit-pending'
  | 'notion-sync-pending'
  | 'notion-sync-failed'
  | 'tasks-member'
  | 'tasks-long-content'
  | 'dashboard-default'
  | 'dashboard-no-meeting'
  | 'dashboard-notion-not-connected'
  | 'dashboard-no-auto'
  | 'dashboard-sync-pending'
  | 'dashboard-sync-failed'
  | 'dashboard-revert-rejected'
  | 'dashboard-member'
  | 'dashboard-partial-error'
  | 'dashboard-recent-overflow'
  | 'settings-discord-skipped'
  | 'settings-unmapped'
  | 'settings-discord-empty'
  | 'settings-member'
  | 'team-invitations'
  | 'invitation-pending'
  | 'messages-default'
  | 'messages-member'
  | 'messages-member-push'
  | 'messages-pm-self'
  | 'messages-schedule-passed'
  | 'messages-long-content'
  | 'reply-judgment'
  | 'reply-judgment-member'
  | 'login-rate-limited'

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
  // 로딩 스플래시(#430)는 화면 뼈대가 모두 걷힐 때까지 앱을 덮고 #root 를 inert 로 막는다. 헤더가 판 아래에 그려져 있어도
  // 아직 포커스·클릭이 닿지 않으므로 판이 걷힐 때까지 기다린다
  await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 })
}

/**
 * 모의 메일함에 간 마지막 코드. 메일함 화면은 새 문서라 코드 단계가 사라지므로 저장된 모의 db 에서 읽는다.
 * 메일함 화면 자체는 signup-kakao.e2e.ts 가 본다
 */
export async function readMailedCode(page: Page): Promise<string> {
  let code: string | undefined
  await expect
    .poll(async () => {
      code = await page.evaluate(() => {
        const saved = JSON.parse(sessionStorage.getItem('msw-db') ?? '{}') as {
          db?: { signupVerification?: { outbox: { code: string }[] } }
        }
        return saved.db?.signupVerification?.outbox.at(-1)?.code
      })
      return code
    })
    .toBeDefined()
  return code as string
}

/** 가입 프로필의 아이디 칸을 채우고 중복 확인을 마친다 (#627) */
export async function confirmUsername(page: Page, username: string): Promise<void> {
  await page.getByLabel('아이디').fill(username)
  await page.getByRole('button', { name: '중복 확인' }).click()
  await expect(page.getByText('사용할 수 있는 아이디예요.')).toBeVisible()
}

/** 이메일 앞부분의 영문·숫자로 만든 아이디. 짧으면 앞에 user 를 붙인다 */
function usernameFor(email: string): string {
  const local = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return (local.length < 4 ? `user${local}` : local).slice(0, 20)
}

/** 가입 동의(#565). 정책이 게시된 동안 `계정 만들기` 전에 필수 항목 둘을 체크한다 */
export async function agreeToPolicies(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }).check()
  await page.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의', exact: true }).check()
}

/** 이메일 → 코드 → 프로필을 밟고 `계정 만들기` 를 누른다 (#427, #627) */
export async function signUp(
  page: Page,
  values: { name: string; email: string; password: string },
): Promise<void> {
  // 주소는 lazy 화면보다 먼저 바뀐다. 앞 화면의 이메일 칸에 쓰지 않게 이 화면의 버튼부터 기다린다
  const sendCode = page.getByRole('button', { name: '인증 코드 받기' })
  await expect(sendCode).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('이메일').fill(values.email)
  await sendCode.click()
  await expect(page.getByLabel('인증 코드')).toBeVisible()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  await confirmUsername(page, usernameFor(values.email))
  await page.getByLabel('이름').fill(values.name)
  await page.getByLabel('비밀번호', { exact: true }).fill(values.password)
  await agreeToPolicies(page)
  await page.getByRole('button', { name: '계정 만들기' }).click()
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

/** 가로 스크롤이 생기지 않았는지 — 최소 지원 폭은 360px 이다 (D-180). 어느 화면을 어느 폭에서 보는지는 layout.e2e.ts 가 정한다 */
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

/**
 * 정리가 끝난 회의의 회의록이 열린다. 모의 `meeting-instant` 는 첫 조회에 바로 `done` 이라, 병렬 부하로 처리 화면(lazy)이
 * 그려지기 전에 완료 응답이 오면 추적기는 자동 이동 없이 도착한 사람에게 `정리가 끝났어요 · 회의록 보기` 를 보인다
 * (useProcessingTracker.leaveProcessingScreen — 그려진 처리 화면에서만 옮긴다). 둘 다 정상 결과라 링크가 보이면 눌러 회의록으로 간다.
 * 자동 이동 자체의 시점은 추적기 통합 테스트가 고정된 순서로 본다 (lateAsyncRaces·processingTracker)
 */
export async function expectMinutesOpened(page: Page, timeout = 15_000): Promise<void> {
  const minutes = /^\/workspaces\/ws_01\/meetings\/mt_\w+$/
  const open = page.getByRole('link', { name: '회의록 보기' })
  await expect(async () => {
    if (!minutes.test(new URL(page.url()).pathname) && (await open.isVisible())) await open.click()
    expect(minutes.test(new URL(page.url()).pathname)).toBe(true)
  }).toPass({ timeout })
}

/** 화면을 테스트 출력 폴더에 이름대로 남기고 보고서에 붙인다 — 검증 실행의 증거 폴더(test-results)에 그대로 남는다 */
export async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}
