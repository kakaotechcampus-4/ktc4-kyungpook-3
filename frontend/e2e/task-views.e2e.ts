import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

/*
 * M8 A — 태스크 보기(보드·캘린더·간트). 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 브라우저 시계는 실제 날짜라 캘린더의 달과 간트 창은 주소로 픽스처의 달(2026-09)에 고정한다.
 *
 * - tasks-default: ws_01 의 PM. 태스크 10건, 대기 생성 승인 3건(ap_03 배포 문서 보완만 마감 9/25)
 * - tasks-long-content: 같은 공간에 긴 제목·줄바꿈할 곳이 없는 제목 3건(9/18~9/19)과 긴 담당자 이름(mb_03)을 더한다
 * - tasks-member: 같은 공간의 일반 팀원
 */

/** 한 테스트가 lazy 화면과 lazy 보기를 함께 지난다 — tasks-approval.e2e.ts 와 같은 까닭으로 전체 한도만 늘린다 (F-r3) */
test.describe.configure({ timeout: 60_000 })

/** lazy 화면·보기로 옮긴 뒤 첫 단언 — 개발 서버가 처음 변환하는 동안 기본 5초를 넘길 때가 있다 */
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

/** 보기 모듈을 받은 요청. 개발 서버는 모듈마다 `/src/...` 로 따로 보낸다 */
function recordViewModules(page: Page) {
  const loaded: string[] = []
  page.on('request', (request) => {
    const match = /\/src\/widgets\/task-board\/ui\/(BoardView|CalendarView|GanttView)\.tsx/.exec(
      request.url(),
    )
    if (match) loaded.push(match[1])
  })
  return loaded
}

function recordApprovalRequests(page: Page) {
  const requests: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/v1/approvals')) requests.push(pathname)
  })
  return requests
}

test('리스트로 들어오면 세 보기 코드를 받지 않고, 고른 보기의 코드만 그때 받는다 (AC-A-02)', async ({
  page,
}) => {
  const loaded = recordViewModules(page)
  await start(page, 'tasks-default', TASKS)
  await expect(page.getByRole('list', { name: '태스크 목록' })).toBeVisible(FIRST_PAINT)
  expect(loaded).toEqual([])

  const switcher = page.getByLabel('보기 방식')
  await switcher.getByRole('radio', { name: '보드' }).click()
  await expect(areaOf(page, 'board')).toBeVisible(FIRST_PAINT)
  expect(loaded).toEqual(['BoardView'])

  await switcher.getByRole('radio', { name: '캘린더' }).click()
  await expect(page.getByRole('grid')).toBeVisible(FIRST_PAINT)
  await switcher.getByRole('radio', { name: '간트' }).click()
  await expect(page.getByRole('table', { name: '일정' })).toBeVisible(FIRST_PAINT)
  expect(loaded).toEqual(['BoardView', 'CalendarView', 'GanttView'])
})

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

test.describe('역할과 상세 링크 (AC-A-06)', () => {
  for (const view of VIEWS) {
    test(`${LABEL[view]} — PM 은 확인 필요를 함께 보고, 태스크를 누르면 그 상세로 간다`, async ({
      page,
    }) => {
      await start(page, 'tasks-default', viewPath(view))
      await expect(areaOf(page, view)).toBeVisible(FIRST_PAINT)
      if (view === 'board')
        await expect(page.getByText(/리스트 뷰에서 승인하면 이 보드로 넘어옵니다/)).toBeVisible()
      else await expect(page.getByText('배포 문서 보완').first()).toBeVisible()

      await page
        .getByRole('link', { name: /로그인 API 연동/ })
        .first()
        .click()
      await expect(page).toHaveURL(new RegExp(`${TASKS}/tk_01$`))
      await expect(page.getByRole('heading', { name: '로그인 API 연동' })).toBeVisible(FIRST_PAINT)
    })

    test(`${LABEL[view]} — 일반 팀원은 확인 필요가 없고 승인 API 를 부르지 않는다`, async ({
      page,
    }) => {
      const approvals = recordApprovalRequests(page)
      await start(page, 'tasks-member', viewPath(view))
      await expect(areaOf(page, view)).toBeVisible(FIRST_PAINT)
      await expect(page.getByRole('link', { name: /로그인 API 연동/ }).first()).toBeVisible()
      await expect(page.getByText(/배포 문서 보완|알림 문구 검토|테스트 계획 정리/)).toHaveCount(0)
      await expect(page.getByText(/리스트 뷰에서 승인하면/)).toHaveCount(0)
      expect(approvals).toEqual([])
    })
  }
})
