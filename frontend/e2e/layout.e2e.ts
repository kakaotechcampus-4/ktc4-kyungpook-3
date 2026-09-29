import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'
import type { Scenario } from './support'

/*
 * U5-4 레이아웃 — 1024·1280·1440px 에서 주요 화면에 가로 스크롤이 없고 핵심 요소가 화면 안에 보인다.
 * 화면마다 스크린샷을 테스트 결과에 붙인다(playwright-report).
 */

const VIEWPORTS = [1024, 1280, 1440] as const

const SCREENS: {
  name: string
  scenario: Scenario
  path: string
  role: 'link' | 'button'
  landmark: string
}[] = [
  { name: '랜딩', role: 'link', scenario: 'signed-out', path: '/', landmark: '시작하기' },
  { name: '로그인', role: 'button', scenario: 'signed-out', path: '/login', landmark: '로그인' },
  {
    name: '회원가입',
    role: 'button',
    scenario: 'signed-out',
    path: '/signup',
    landmark: '계정 만들기',
  },
  {
    name: '워크스페이스 선택',
    role: 'button',
    scenario: 'multiple-workspaces',
    path: '/workspaces',
    landmark: '새 워크스페이스 만들기',
  },
  {
    name: '온보딩',
    role: 'button',
    scenario: 'incomplete-workspace',
    path: '/onboarding/ws_03/connect_discord',
    landmark: '연결하기',
  },
  {
    name: '대시보드',
    role: 'link',
    scenario: 'multiple-workspaces',
    path: '/workspaces/ws_01/dashboard',
    landmark: '회의록으로 가기',
  },
]

for (const width of VIEWPORTS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const screen of SCREENS) {
      test(`${screen.name} — 가로 스크롤 없음`, async ({ page }, testInfo) => {
        await start(page, screen.scenario, screen.path)
        const landmark = page.getByRole(screen.role, { name: screen.landmark, exact: true }).first()
        await expect(landmark).toBeInViewport()
        await expectNoHorizontalOverflow(page)
        await testInfo.attach(`${screen.name}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }

    test('앱 헤더 — 탭 5개와 두 메뉴가 한 줄에 보인다', async ({ page }) => {
      await start(page, 'multiple-workspaces', '/workspaces/ws_01/dashboard')
      const header = page.getByRole('banner')
      const tabs = header.getByRole('navigation', { name: '주요 화면' }).getByRole('link')
      await expect(tabs).toHaveCount(5)
      const menus = [/^워크스페이스 바꾸기/, /^내 계정/].map((name) =>
        header.getByRole('button', { name }),
      )
      for (const menu of menus) await expect(menu).toBeInViewport()

      // 높이 대신 위치로 본다 — 줄바꿈이 없으면 탭은 모두 같은 top, 헤더 항목은 모두 같은 세로 중심에 있다
      const boxOf = async (locator: Locator) => {
        const box = await locator.boundingBox()
        expect(box).not.toBeNull()
        return box!
      }
      const tabBoxes = await Promise.all((await tabs.all()).map(boxOf))
      for (const box of tabBoxes) expect(Math.abs(box.y - tabBoxes[0].y)).toBeLessThanOrEqual(1)
      const items = [
        header.getByRole('link', { name: "Manager's Manager 대시보드" }),
        ...(await tabs.all()),
        ...menus,
      ]
      const itemBoxes = await Promise.all(items.map(boxOf))
      const centers = itemBoxes.map((box) => box.y + box.height / 2)
      for (const center of centers) expect(Math.abs(center - centers[0])).toBeLessThanOrEqual(1)
      // 왼쪽에서 오른쪽으로 차례로 놓인다 — 줄이 넘어가면 이 순서가 깨진다
      const lefts = itemBoxes.map((box) => box.x)
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
      await expectNoHorizontalOverflow(page)
    })
  })
}
