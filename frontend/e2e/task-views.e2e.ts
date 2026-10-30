import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

/*
 * M8 A — 태스크 보기(보드·캘린더·간트)의 너비별 배치 (AC-A-03). 실제 브라우저에서만 잴 수 있는 페이지·영역 폭과 가로 스크롤만 본다.
 * 코드 나누기(AC-A-02)·조회 상태(AC-A-05)·역할·상세 링크·공간 격리(AC-A-06)는 Vitest(src/app/taskViews*.test.tsx)와
 * Storybook(M8 태스크/보기)이 본다. 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 브라우저 시계는 실제 날짜라 캘린더의 달과 간트 창은 주소로 픽스처의 달(2026-09)에 고정한다.
 *
 * - tasks-long-content: ws_01 의 PM. 픽스처에 긴 제목·줄바꿈할 곳이 없는 제목 3건(9/18~9/19)과 긴 담당자 이름(mb_03)을 더한다
 */

/** 한 테스트가 lazy 화면과 lazy 보기를 함께 지난다 — tasks-approval.e2e.ts 와 같은 까닭으로 전체 한도만 늘린다 (F-r3) */
test.describe.configure({ timeout: 60_000 })

/** lazy 화면·보기의 첫 단언 — 개발 서버가 처음 변환하는 동안 기본 5초를 넘길 때가 있다 */
const FIRST_PAINT = { timeout: 15_000 }

type View = 'board' | 'calendar' | 'gantt'
const VIEWS: readonly View[] = ['board', 'calendar', 'gantt']
const LABEL: Record<View, string> = { board: '보드', calendar: '캘린더', gantt: '간트' }

const TASKS = '/workspaces/ws_01/tasks'
const viewPath = (view: View) => `${TASKS}?view=${view}&month=2026-09&from=2026-09-14`

/** 그 보기의 본문 영역 — 보드는 세 칸 격자, 캘린더는 날짜 격자, 간트는 표를 감싼 가로 스크롤 영역 */
function areaOf(page: Page, view: View): Locator {
  if (view === 'board') return page.getByRole('region', { name: '시작 전' }).locator('..')
  if (view === 'calendar') return page.getByRole('grid', { name: '2026년 9월' })
  return page.getByRole('region', { name: '일정 표' })
}

/**
 * 본문 영역 안의 무엇도 영역의 스크롤 끝보다 오른쪽으로 삐져나오지 않는다 — 넘치는 내용은 접히거나 영역 안 스크롤로 닿는다
 */
async function expectNothingSticksOut(area: Locator) {
  const sticking = await area.evaluate((element) => {
    const end = element.getBoundingClientRect().left + element.scrollWidth - element.scrollLeft
    return [...element.querySelectorAll('*')]
      .filter((node) => node.getBoundingClientRect().right > end + 1)
      .map((node) => (node.textContent ?? '').slice(0, 30))
  })
  expect(sticking).toEqual([])
}

const scrollState = (area: Locator) =>
  area.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    left: element.scrollLeft,
  }))

for (const width of [1024, 1440, 1920] as const) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const view of VIEWS) {
      test(`${LABEL[view]} — 페이지는 가로로 넘치지 않고 긴 내용은 영역 안에서 끝까지 닿는다 (AC-A-03)`, async ({
        page,
      }, testInfo) => {
        await start(page, 'tasks-long-content', viewPath(view))
        const area = areaOf(page, view)
        await expect(area).toBeVisible(FIRST_PAINT)
        await expectNoHorizontalOverflow(page)
        // 핵심 조작이 화면 안에 있다
        await expect(page.getByLabel('보기 방식')).toBeInViewport()
        if (view === 'board')
          await expect(page.getByRole('button', { name: /^담당자:/ })).toBeInViewport()
        else await expect(page.getByRole('button', { name: /^다음/ })).toBeInViewport()

        // 줄바꿈할 곳이 없는 제목은 칸 안에서 접힌다(간트 왼쪽 칸은 말줄임이다)
        if (view !== 'gantt') {
          const title = area.getByRole('link', { name: /^ABCDEFGHIJ/ }).first()
          const { client, scroll } = await title.evaluate((element) => ({
            client: element.clientWidth,
            scroll: element.scrollWidth,
          }))
          expect(scroll).toBeLessThanOrEqual(client + 1)
        }

        const before = await scrollState(area)
        // 간트 표는 날짜 칸 최소 폭(48px)으로 1262px 이 필요하다 — 1024px 본문(926px)에서만 영역 안에서 민다
        expect(before.scroll > before.client).toBe(view === 'gantt' && width === 1024)
        if (before.scroll > before.client) {
          // 넘칠 때만 Tab 자리다. 키보드로 밀고, 끝까지 밀면 마지막 날짜 칸까지 영역 안에 보인다
          await expect(area).toHaveAttribute('tabindex', '0')
          await area.focus()
          await page.keyboard.press('ArrowRight')
          await expect.poll(async () => (await scrollState(area)).left).toBeGreaterThan(0)
          await area.evaluate((element) => {
            element.scrollLeft = element.scrollWidth
          })
          await expect
            .poll(async () => {
              const { client, scroll, left } = await scrollState(area)
              return left + client >= scroll - 1
            })
            .toBe(true)
          const areaBox = (await area.boundingBox())!
          const lastDay = (await area.getByText('4', { exact: true }).last().boundingBox())!
          expect(lastDay.x + lastDay.width).toBeLessThanOrEqual(areaBox.x + areaBox.width)
          await expectNoHorizontalOverflow(page)
        } else if (view === 'gantt') await expect(area).not.toHaveAttribute('tabindex')
        await expectNothingSticksOut(area)

        await testInfo.attach(`${view}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })
      })
    }
  })
}
