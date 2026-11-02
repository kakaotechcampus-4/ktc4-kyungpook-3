import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoHorizontalOverflow, finishOAuth, start } from './support'

/*
 * M8-B — 설정에서 온보딩 때 건너뛴 Discord 를 연결한다 (D-011). 모의 OAuth 는 현재 탭 이동이다 (D-158).
 * 연결이 확인되면 팀 화면의 팀원 연결 창으로 간다 (D-074).
 * settings-discord-skipped 는 ws_03 이 온보딩을 마쳤고 Discord·팀원 연결을 건너뛰었다. Notion 만 연결돼 있다.
 * 브라우저에서만 볼 수 있는 것만 둔다 — 현재 탭 OAuth 왕복과 새로고침 뒤 상태, 너비·키보드.
 * 취소·실패·재조회 불일치·조회 오류·일반 팀원은 app/settingsConnections.test.tsx 와 Discord 영역 스토리가 본다
 */

const SETTINGS = '/workspaces/ws_03/settings'
const TEAM = '/workspaces/ws_03/members'

/** 새 문서로 다시 뜬 설정 화면이 그려질 때까지 — 개발 서버가 바쁠 때 기본 5초를 넘긴다 */
const FIRST_PAINT = { timeout: 15_000 }

const discordArea = (page: Page) => page.getByTestId('discord-connection')

/** 온보딩 단계 저장(`PATCH .../onboarding`)을 센다. 설정의 연결은 단계를 저장하지 않는다 (D-173) */
function countOnboardingSaves(page: Page): () => number {
  let count = 0
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && /\/onboarding$/.test(new URL(request.url()).pathname))
      count += 1
  })
  return () => count
}

test('PM 이 설정에서 Discord 를 연결하면 팀원 연결 창으로 가고, 새로고침해도 연결이 남는다 (D-074)', async ({
  page,
}) => {
  const onboardingSaves = countOnboardingSaves(page)
  await start(page, 'settings-discord-skipped', SETTINGS)
  const area = discordArea(page)
  await expect(area.getByText('연결 안 됨')).toBeVisible()
  await area.getByRole('button', { name: 'Discord 연결하기' }).click()

  await finishOAuth(page, '디스코드')
  // 연결을 확인하면 팀 화면의 팀원 연결 창으로 간다. 복귀 표시는 주소에 남지 않는다
  await expect(page).toHaveURL(`${TEAM}?connect=members`)
  const dialog = page.getByRole('dialog', { name: '팀원 연결' })
  await expect(dialog.getByLabel('@jihun_dev의 팀원 이름')).toBeVisible(FIRST_PAINT)

  // 창은 주소가 쥔다 — 새로고침해도 열려 있고, 아무도 잇지 않고 닫을 수 있다 (D-075)
  await page.reload()
  await expect(dialog.getByLabel('@jihun_dev의 팀원 이름')).toBeVisible(FIRST_PAINT)
  await dialog.getByRole('button', { name: '나중에 하기' }).click()
  await expect(page).toHaveURL(TEAM)
  await expect(
    page.getByRole('region', { name: '연결되지 않은 계정' }).getByText('jihun_dev'),
  ).toBeVisible()

  await page.goto(SETTINGS)
  await expect(discordArea(page).getByText('연결됨', { exact: true })).toBeVisible(FIRST_PAINT)
  expect(onboardingSaves()).toBe(0)
})

for (const width of [1024, 1440, 1920]) {
  test(`${width}px 설정·팀 화면은 가로로 넘치지 않고 설정의 연결 줄을 키보드로 다룬다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await start(page, 'settings-discord-skipped', SETTINGS)
    // 두 연결 버튼이 함께 보이도록 Notion 도 끊고(PM 의 DELETE) 다시 연다. 모의 db 는 응답마다 저장돼 새로고침에도 남는다
    await page.evaluate(() =>
      fetch('/api/v1/workspaces/ws_03/integrations/notion', { method: 'DELETE' }),
    )
    await page.reload()
    const discord = discordArea(page)
    const notion = page.getByTestId('notion-connection')
    // 상태는 점 색만이 아니라 문구로도 구분한다 (D-128)
    await expect(discord.getByText('연결 안 됨')).toBeVisible(FIRST_PAINT)
    await expect(notion.getByText('연결 안 됨')).toBeVisible()
    await expect(discord).toBeInViewport()
    await expectNoHorizontalOverflow(page)

    // 이름 칸 → Discord 연결 → Notion 연결 순서다(`되돌리기` 는 바꾼 것이 없어 꺼져 있다)
    await page.getByLabel('워크스페이스 이름').focus()
    await page.keyboard.press('Tab')
    const connectDiscord = discord.getByRole('button', { name: 'Discord 연결하기' })
    await expect(connectDiscord).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(notion.getByRole('button', { name: 'Notion 연결하기' })).toBeFocused()
    // Shift+Tab 으로 Discord 로 돌아와 Enter 로 연다
    await page.keyboard.press('Shift+Tab')
    await expect(connectDiscord).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/__mock\/oauth\/ws_03\/discord/)

    // 팀 화면(Team 캔버스의 두 단과 앞으로 7일)도 같은 너비에서 넘치지 않는다
    await page.goto(TEAM)
    await expect(page.getByRole('heading', { name: '앞으로 7일' })).toBeVisible(FIRST_PAINT)
    await expectNoHorizontalOverflow(page)
  })
}
