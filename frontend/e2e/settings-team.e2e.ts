import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoHorizontalOverflow, finishOAuth, start } from './support'

/*
 * M8-B B-1 — 설정에서 온보딩 때 건너뛴 Discord 를 연결한다 (D-011). 모의 OAuth 는 현재 탭 이동이다 (D-158).
 * settings-discord-skipped 는 ws_03 이 온보딩을 마쳤고 Discord·팀원 연결을 건너뛰었다. Notion 만 연결돼 있다.
 * 브라우저에서만 볼 수 있는 것만 둔다 — 현재 탭 OAuth 왕복과 새로고침 뒤 상태, 너비·키보드.
 * 취소·실패·재조회 불일치·조회 오류·일반 팀원은 app/settingsConnections.test.tsx 와 Discord 영역 스토리가 본다
 */

const SETTINGS = '/workspaces/ws_03/settings'

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

test('PM 이 설정에서 Discord 를 연결한다 — 복귀 뒤 연결됨이고 새로고침해도 남는다', async ({
  page,
}) => {
  const onboardingSaves = countOnboardingSaves(page)
  await start(page, 'settings-discord-skipped', SETTINGS)
  const area = discordArea(page)
  await expect(area.getByText('연결 안 됨')).toBeVisible()
  await area.getByRole('button', { name: 'Discord 연결하기' }).click()

  await finishOAuth(page, '디스코드')
  // 설정에 머문다. 복귀 표시는 주소에서 지운다
  await expect(page).toHaveURL(SETTINGS)
  await expect(discordArea(page).getByText('연결됨')).toBeVisible(FIRST_PAINT)
  await expect(discordArea(page).getByRole('button')).toHaveCount(0)

  await page.reload()
  await expect(discordArea(page).getByText('연결됨')).toBeVisible(FIRST_PAINT)
  await expect(page.getByTestId('notion-connection').getByText('연결됨')).toBeVisible()
  expect(onboardingSaves()).toBe(0)
})

for (const width of [1024, 1440, 1920]) {
  test(`${width}px 설정 화면은 가로로 넘치지 않고 연결 줄을 키보드로 다룬다`, async ({ page }) => {
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
  })
}
