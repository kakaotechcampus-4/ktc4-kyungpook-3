import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'
import type { Scenario } from './support'

/*
 * M5 U6-3 레이아웃 — 회의 올리기·처리·회의록을 1024·1440·1920px 에서 연다.
 * 가로 스크롤이 없고, 한 단 화면은 캔버스 폭(올리기 700 · 처리 560)을 넘지 않고 가운데 있으며, 회의록은 목록(308)과 본문이
 * 한 줄에 나란히 놓여 본문이 남은 폭을 채운다. 화면마다 스크린샷을 테스트 결과에 붙인다(playwright-report).
 */

/** 화면을 처음 그릴 때까지 — 개발 서버가 lazy 화면을 처음 변환하는 동안 기본 5초를 넘길 때가 있다 (support.start 와 같다) */
const FIRST_PAINT = { timeout: 15_000 }

const VIEWPORTS = [1024, 1440, 1920] as const

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

/** 문서 폭(스크롤바 제외) */
function clientWidth(page: Page) {
  return page.evaluate(() => document.documentElement.clientWidth)
}

/** 한 단 화면 — 폭이 max 이하이고 문서 가운데에 있다 */
async function expectCenteredColumn(page: Page, column: Locator, max: number) {
  const box = await boxOf(column)
  const width = await clientWidth(page)
  expect(box.width).toBeLessThanOrEqual(max)
  // 1024px 에서도 좌우 여백(48)을 빼고 남는 폭이 캔버스 폭보다 넓다 — 줄어들지 않고 캔버스 폭 그대로다
  expect(box.width).toBeGreaterThan(max - 1)
  const left = box.x
  const right = width - (box.x + box.width)
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
}

const SCREENS: {
  name: string
  scenario: Scenario
  path: string
  check: (page: Page) => Promise<void>
}[] = [
  {
    name: '회의 올리기',
    scenario: 'meeting-instant',
    path: '/workspaces/ws_01/meetings/upload',
    check: async (page) => {
      await expect(page.getByRole('heading', { name: '회의를 올려 주세요' })).toBeVisible(
        FIRST_PAINT,
      )
      const form = page.locator('main form')
      await expectCenteredColumn(page, form, 700)
      // 끌어다 놓는 칸·참석자·제출이 모두 가로로 화면 안이다
      for (const target of [
        page.getByTestId('audio-dropzone'),
        page.getByRole('button', { name: '추가', exact: true }),
        page.getByRole('button', { name: '정리 시작하기' }),
      ])
        await expect(target).toBeInViewport()
      // 제목·날짜 칸이 한 줄이다 (캔버스: 제목 · 날짜 200px)
      const title = await boxOf(page.getByLabel('회의 제목'))
      const date = await boxOf(page.getByLabel('회의 날짜'))
      expect(Math.abs(title.y - date.y)).toBeLessThanOrEqual(1)
      expect(title.x + title.width).toBeLessThanOrEqual(date.x)
    },
  },
  {
    name: '처리',
    // ws_01 의 mt_10 이 정리 중이다. 흐름 방식이 manual 이라 polling 해도 단계가 그대로다
    scenario: 'single-workspace',
    path: '/workspaces/ws_01/meetings/mt_10/processing',
    check: async (page) => {
      await expect(page.getByRole('heading', { name: '정리하고 있어요' })).toBeVisible(FIRST_PAINT)
      const steps = page.getByRole('list', { name: '정리 단계' })
      await expect(steps.getByRole('listitem')).toHaveCount(3)
      // 단계 목록이 든 본문 단 — 제목·단계·안내를 담은 560px 칸
      await expectCenteredColumn(page, steps.locator('xpath=../..'), 560)
      for (const row of await steps.getByRole('listitem').all()) await expect(row).toBeInViewport()
    },
  },
  {
    name: '회의록',
    scenario: 'single-workspace',
    path: '/workspaces/ws_01/meetings/mt_09',
    check: async (page) => {
      const aside = page.getByRole('complementary', { name: '회의 목록' })
      const body = page.getByRole('region', { name: '회의록 본문' })
      await expect(body.getByRole('heading', { name: '3주차 정기회의' })).toBeVisible(FIRST_PAINT)
      await expect(body.getByRole('tablist')).toBeInViewport()
      const list = await boxOf(aside)
      const detail = await boxOf(body)
      const width = await clientWidth(page)
      // 목록은 308px 그대로, 본문은 그 오른쪽 같은 줄에서 남은 폭을 채운다
      expect(list.width).toBe(308)
      expect(Math.abs(list.y - detail.y)).toBeLessThanOrEqual(1)
      expect(list.x + list.width).toBeLessThanOrEqual(detail.x + 1)
      expect(detail.x + detail.width).toBeLessThanOrEqual(width + 1)
      expect(detail.width).toBeGreaterThanOrEqual(width - list.width - list.x - 1)
    },
  },
]

for (const width of VIEWPORTS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const screen of SCREENS) {
      test(`${screen.name} — 가로 스크롤 없이 캔버스 배치를 지킨다`, async ({ page }, testInfo) => {
        await start(page, screen.scenario, screen.path)
        await screen.check(page)
        await expectNoHorizontalOverflow(page)
        await testInfo.attach(`${screen.name}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }
  })
}
