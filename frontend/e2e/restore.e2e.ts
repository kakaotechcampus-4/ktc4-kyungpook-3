import { expect, test } from '@playwright/test'
import { finishOAuth, signUp, start } from './support'

/*
 * 시나리오 ③ 새로고침·OAuth 왕복 뒤 진행 상태 복원 (U5-2).
 * 브라우저 MSW 의 sessionStorage 저장·복원(startMockWorker → prepareBrowserDb → response:mocked 저장)을
 * 실제 브라우저에서 덮는다 — 이월 U1-r1 #2
 */

test('가입한 계정·세션·만든 공간·온보딩 단계가 새로고침 뒤에도 남는다', async ({ page }) => {
  await start(page, 'signed-out', '/signup')
  await signUp(page, { name: '복원 확인', email: 'restore@example.com', password: 'pass1234' })
  await expect(page).toHaveURL('/onboarding/start')
  await page.getByRole('link', { name: /PM으로 팀 만들기/ }).click()
  await expect(page).toHaveURL('/onboarding/create_workspace')

  await page.getByLabel('팀 이름').fill('복원 팀')
  await page.getByRole('button', { name: '만들기' }).click()
  await expect(page).toHaveURL(/\/onboarding\/ws_\d+\/connect_discord$/)
  const discordStep = page.url()

  // 새로고침 — 모듈 상태는 사라지고 sessionStorage 만 남는다
  await page.reload()
  await expect(page).toHaveURL(discordStep)
  await expect(page.getByRole('heading', { name: '디스코드 연동' })).toBeVisible()

  // 건너뛴 뒤 새로고침해도 저장된 다음 단계다
  await page.getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL(/\/connect_notion$/)
  await page.reload()
  await expect(page).toHaveURL(/\/connect_notion$/)

  // 루트로 새로 들어와도(직접 URL 진입) 저장된 미완료 단계로 간다
  await page.goto('/')
  await expect(page).toHaveURL(/\/connect_notion$/)

  // E2E 는 앱 모듈을 가져오지 않아 현재 MOCK_DB_VERSION 을 직접 단언한다.
  const store = await page.evaluate(() => sessionStorage.getItem('msw-db'))
  expect(store).toContain('restore@example.com')
  expect(JSON.parse(store ?? '{}')).toMatchObject({ version: 25 })
})

test('OAuth 왕복(현재 탭 이동 두 번)을 지나도 로그인·연동·단계가 이어진다', async ({ page }) => {
  await start(page, 'incomplete-workspace', '/')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_discord')

  await page.getByRole('button', { name: '연결하기' }).click()
  // 모의 OAuth 화면은 새 문서다 — 세션과 db 가 sessionStorage 에서 복원돼야 이 화면이 뜬다
  await finishOAuth(page, '디스코드')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')
  // 복귀 표시는 주소에서 지워졌다
  await expect(page).not.toHaveURL(/oauth_result/)

  // 새로고침해도 연동과 단계가 남는다
  await page.reload()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')
  await expect(page.getByText('디스코드 연동 완료')).toBeVisible()
})

test('Notion 에서 `이전 단계` 로 연결한 Discord 를 둘러보고 `다음 단계` 로 돌아온다 (2026-09-29)', async ({
  page,
}) => {
  await start(page, 'incomplete-workspace', '/')
  await page.getByRole('button', { name: '연결하기' }).click()
  await finishOAuth(page, '디스코드')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')

  const nav = page.getByRole('navigation', { name: '단계 이동' })
  await nav.getByRole('button', { name: '이전 단계' }).click()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_discord?review=1')
  const card = page.getByRole('region', { name: '디스코드 연동' })
  await expect(card.getByText('연결됨')).toBeVisible()
  // 둘러보기 카드의 앞으로 가기는 `다음` 하나다 (2026-09-29). `어떻게 쓰나요?` 는 안내를 여는 글자 링크다 (#650)
  await expect(card.getByRole('button').filter({ hasNotText: '어떻게 쓰나요?' })).toHaveCount(1)
  await expect(card.getByRole('button', { name: '다음', exact: true })).toBeVisible()

  // 둘러보기의 `다음 단계` 는 요청 없이 이어 갈 단계로 간다
  await nav.getByRole('button', { name: '다음 단계' }).click()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')
  await expect(page.getByRole('region', { name: '노션 연동' })).toBeVisible()
})

test('손상된 저장값은 버리고 비로그인으로 시작한다', async ({ page }) => {
  await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
  await expect(page.getByRole('heading', { name: '최근 반영' })).toBeVisible()

  // 손상값은 다음 문서의 맨 앞(앱 스크립트보다 먼저)에서 한 번만 쓴다. 지금 문서에서 쓰면 늦게 끝난 모의 응답의
  // 저장(response:mocked)이 reload 전에 덮어쓸 수 있다. 앱이 읽은 값을 그대로 남겨 실제로 손상값에서 시작했는지 본다
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-corrupted') !== null) return
    sessionStorage.setItem('msw-db', '{broken')
    sessionStorage.setItem('e2e-corrupted', 'written')
  })
  await page.reload()
  // 보던 화면은 로그인 뒤 돌아갈 경로로 남는다 (#411)
  await expect(page).toHaveURL('/login?next=%2Fworkspaces%2Fws_01%2Fdashboard')

  const after = await page.evaluate(() => ({
    marker: sessionStorage.getItem('e2e-corrupted'),
    stored: sessionStorage.getItem('msw-db'),
  }))
  // 이 문서가 손상값으로 시작했다
  expect(after.marker).toBe('written')
  // 손상값은 버려지고 비로그인 시작 상태가 현재 버전(MOCK_DB_VERSION, 위 첫 시나리오 참고)으로 새로 저장됐다
  expect(after.stored).not.toBe('{broken')
  expect(JSON.parse(after.stored ?? 'null')).toMatchObject({
    version: 25,
    db: { authenticated: false },
  })
})
