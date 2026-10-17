import { expect, test } from '@playwright/test'
import { finishOAuth, start } from './support'

/* 시나리오 ① 가입 → 온보딩 전 단계(모의 OAuth 포함) → 새 공간 대시보드 (U5-2) */

test('가입 → 워크스페이스 만들기 → Discord·Notion 모의 OAuth → 팀원 연결 → 대시보드', async ({
  page,
}) => {
  await start(page, 'signed-out')

  // 랜딩 `시작하기` → 로그인 → 회원가입 링크 (D-003, D-004)
  await page.getByRole('banner').getByRole('link', { name: '시작하기' }).click()
  await expect(page).toHaveURL('/login')
  await page.getByRole('link', { name: '회원가입' }).click()
  await expect(page).toHaveURL('/signup')

  // 키보드로 채우고 제출한다
  await page.getByLabel('이름').fill('새 사용자')
  await page.getByLabel('이메일').fill('e2e@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByLabel('비밀번호', { exact: true }).press('Enter')

  // 공간 0개 → 워크스페이스 만들기
  await expect(page).toHaveURL('/onboarding/create_workspace')
  await expect(page.getByRole('img', { name: '4단계 중 1단계' })).toBeVisible()
  await page.getByLabel('팀 이름').fill('  캡스톤   5조 ')
  await page.getByRole('button', { name: '만들기' }).click()

  // Discord: 현재 탭으로 모의 OAuth → 허용 → 복귀 뒤 연동 상태를 다시 조회해 완료
  await expect(page).toHaveURL(/\/onboarding\/ws_\d+\/connect_discord$/)
  await page.getByRole('button', { name: '연결하기' }).click()
  await finishOAuth(page, '디스코드')
  await expect(page).toHaveURL(/\/connect_notion$/)
  await expect(page.getByText('디스코드 연동 완료')).toBeVisible()

  // Notion 도 같은 흐름. 데이터베이스 선택 화면은 없다 (D-154)
  await page.getByRole('button', { name: '연결하기' }).click()
  await finishOAuth(page, '노션')
  await expect(page).toHaveURL(/\/connect_members$/)
  await expect(page.getByText('노션 연동 완료')).toBeVisible()

  // 팀원 연결: 봇은 없고, 생성자 PM 을 체크하면 새로 만들지 않고 연결한다.
  // 확인 완료는 PM 체크가 있어야 한다 (#228) — 예전에는 생성자 이름을 그대로 적어 이었다
  await expect(page.getByText('@manager_bot')).toHaveCount(0)
  await page.getByRole('checkbox', { name: '@seoyeon_01 — PM 새 사용자' }).click()
  await page.getByLabel('@minsu의 팀원 이름').fill('박민수')
  await page.getByRole('button', { name: '2명 확인 완료' }).click()

  // 새 공간의 대시보드 (D-013) — 헤더와 5개 탭이 있는 앱 셸
  await expect(page).toHaveURL(/\/workspaces\/ws_\d+\/dashboard$/)
  // M7 대시보드 — 회의가 없는 새 공간이라 최근 반영은 빈 상태 ①이다
  await expect(page.getByRole('heading', { name: '최근 반영' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '주요 화면' }).getByRole('link')).toHaveCount(5)
  await expect(page.getByRole('button', { name: /^워크스페이스 바꾸기/ })).toContainText(
    '캡스톤 5조',
  )
})

test('팀원 연결: 이름이 달라도 PM 을 체크해 잇고, 다시 들어오면 PM 이 체크된 채 이름 칸이 잠겨 있다 (#228)', async ({
  page,
}) => {
  // 생성자 PM 은 로그인 계정 이름(최진호)으로 이미 있다
  await start(page, 'incomplete-workspace', '/')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_discord')
  await page.getByRole('button', { name: '연결하기' }).click()
  await finishOAuth(page, '디스코드')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')
  await page.getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_members')

  // PM 이름과 다르게 적었어도 PM 을 체크하면 이름 칸은 PM 이름으로 잠긴다. 키보드(Space)로 체크한다
  await page.getByLabel('@seoyeon_01의 팀원 이름').fill('진호')
  await page.getByRole('checkbox', { name: '@seoyeon_01 — PM 최진호' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByLabel('@seoyeon_01의 팀원 이름')).toBeDisabled()
  await expect(page.getByLabel('@seoyeon_01의 팀원 이름')).toHaveValue('최진호')
  await page.getByLabel('@minsu의 팀원 이름').fill('박민수')

  // 나가기는 입력 중 매핑을 저장하고 단계는 완료하지 않는다
  await page.getByRole('link', { name: '온보딩 나가기' }).click()
  await expect(page).toHaveURL('/workspaces')

  // 다시 들어온다(새 문서). PM 이 연결된 줄은 PM 을 체크해 두고 이름 칸을 잠근다
  await page.goto('/onboarding/ws_03/connect_members')
  await expect(page.getByRole('checkbox', { name: '@seoyeon_01 — PM 최진호' })).toBeChecked()
  await expect(page.getByLabel('@seoyeon_01의 팀원 이름')).toBeDisabled()
  await expect(page.getByLabel('@seoyeon_01의 팀원 이름')).toHaveValue('최진호')
  await expect(page.getByLabel('@minsu의 팀원 이름')).toHaveValue('박민수')
  await page.getByRole('button', { name: '2명 확인 완료' }).click()

  // 같은 PM 계정으로 대시보드에 들어간다
  await expect(page).toHaveURL('/workspaces/ws_03/dashboard')
  // M7 대시보드 — 회의가 없는 새 공간이라 최근 반영은 빈 상태 ①이다
  await expect(page.getByRole('heading', { name: '최근 반영' })).toBeVisible()

  // 팀원은 PM 과 새 팀원 둘뿐이다 — PM 은 id·role 을 그대로 두고 Discord 사용자만 이었다
  const members = await page.evaluate(async () => {
    const response = await fetch('/api/v1/members?workspace_id=ws_03')
    const body = (await response.json()) as {
      data: { items: { member_id: string; role: string; discord_user_id: string | null }[] }
    }
    return body.data.items.map(({ member_id, role, discord_user_id }) => ({
      member_id,
      role,
      discord_user_id,
    }))
  })
  expect(members).toEqual([
    { member_id: 'mb_90', role: 'pm', discord_user_id: '1123' },
    { member_id: expect.any(String), role: 'member', discord_user_id: '1124' },
  ])
})

test('모의 OAuth 에서 취소하면 단계는 그대로이고 안내 뒤 건너뛸 수 있다 — 팀원 연결도 따로 건너뛴다', async ({
  page,
}) => {
  await start(page, 'incomplete-workspace', '/')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_discord')

  await page.getByRole('button', { name: '연결하기' }).click()
  await finishOAuth(page, '디스코드', '취소')
  await expect(page).toHaveURL('/onboarding/ws_03/connect_discord')
  await expect(page.getByRole('alert')).toContainText('연결을 취소했어요')

  // D-073 개정(2026-09-29): 예전에는 Discord 를 건너뛰면 팀원 연결도 건너뛰어 Notion 뒤 바로 대시보드였다.
  // 이제 팀원 연결 단계가 오고, Discord 가 없어 안내와 `건너뛰기` 만 있다
  await page.getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_notion')
  await page.getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL('/onboarding/ws_03/connect_members')
  await expect(
    page.getByText('디스코드를 연결하지 않아 팀원을 불러올 수 없어요.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL('/workspaces/ws_03/dashboard')
})
