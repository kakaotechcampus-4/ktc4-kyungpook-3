import { expect, test } from '@playwright/test'
import { capture, expectNoHorizontalOverflow, start } from './support'

test.describe.configure({ timeout: 60_000 })

const PAGES = [
  { route: 'meetings', label: '회의록', title: '아직 올린 회의가 없어요' },
  { route: 'tasks', label: '태스크', title: '아직 태스크가 없어요' },
  { route: 'messages', label: '메시지', title: '보낼 메시지가 없어요' },
  { route: 'project-map', label: '프로젝트 맵', title: '아직 프로젝트 맵이 비어 있어요' },
]

for (const width of [1440, 390, 360, 320]) {
  test(`${width}px 전체 빈 화면의 매스는 네 탭을 오가도 같은 위치에 있다`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
    await start(page, 'no-workspace', '/onboarding/create_workspace')
    await page.getByLabel('팀 이름').fill('빈 화면 매스 정렬 검증')
    await page.getByRole('button', { name: '만들기', exact: true }).click()
    await expect(page).toHaveURL(/\/connect_discord$/)
    for (const next of [/\/connect_notion$/, /\/connect_members$/, /\/dashboard$/]) {
      await page.getByRole('button', { name: '건너뛰기', exact: true }).click()
      await expect(page).toHaveURL(next)
    }
    const workspaceId = new URL(page.url()).pathname.split('/')[2]
    const positions: { x: number; y: number; width: number; height: number }[] = []
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const { route, label, title } of PAGES) {
        if (route === 'project-map' && width < 768) {
          await page.getByRole('button', { name: /^내 계정/ }).click()
          await page.getByRole('menuitem', { name: label, exact: true }).click()
        } else {
          await page
            .getByRole('navigation', { name: '주요 화면' })
            .getByRole('link', { name: label, exact: true })
            .click()
        }
        await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/${route}$`))
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({
          timeout: 15_000,
        })
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
        const mascot = await page.locator('main svg[width="96"][height="96"]').boundingBox()
        expect(mascot).not.toBeNull()
        if (mascot !== null) positions.push(mascot)
        await expectNoHorizontalOverflow(page)
        if (cycle === 0) await capture(page, testInfo, `${route}.png`)
      }
    }
    expect(positions).toHaveLength(8)
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const values = positions.map((position) => position[key])
      expect(Math.max(...values) - Math.min(...values), `매스 ${key}`).toBeLessThanOrEqual(1)
    }
  })
}
