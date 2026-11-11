import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

/*
 * M7 §5 — 대시보드의 핵심 이동·되돌리기·키보드 (AC-02 · AC-04 · AC-06). 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 오늘은 픽스처의 서울 오늘(2026-09-18 09:00 KST)로 고정한다 — 시계만 멈추고 타이머는 그대로 간다.
 * 실제 서버의 되돌리기·Notion 페이지 보관은 여기서 검증하지 않는다(별도 연동 과제).
 *
 * - dashboard-default: ws_01 의 PM. 대기 승인 3건(ap_01 보류 · ap_02 · ap_03), 마감 임박 6건, 최근 반영 3건(모두 반영 완료)
 * - dashboard-member: 같은 공간의 일반 팀원
 * - dashboard-recent-overflow: dashboard-default 에 최근 반영 auto 항목이 12개다 (D-176)
 */

test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }
const DASHBOARD = '/workspaces/ws_01/dashboard'

for (const width of [1280, 390]) {
  test(`${width}px 최근 반영 빈 상태의 업로드는 오른쪽 먹색 버튼이고 방법 보기는 없다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await start(page, 'dashboard-no-meeting', DASHBOARD)
    const recent = page.getByRole('region', { name: '최근 반영' })
    const upload = recent.getByRole('link', { name: '회의 업로드' })
    await expect(upload).toBeVisible(FIRST_PAINT)
    await expect(recent.getByRole('button', { name: '방법 보기' })).toHaveCount(0)
    await expect(upload).toHaveCSS('background-color', 'rgb(51, 51, 51)')
    await expect(upload).toHaveCSS('color', 'rgb(255, 255, 255)')
    const actionBox = await upload.boundingBox()
    const sectionBox = await recent.boundingBox()
    if (actionBox === null || sectionBox === null) throw new Error('최근 반영이 보이지 않아요.')
    expect(actionBox.x + actionBox.width).toBeCloseTo(sectionBox.x + sectionBox.width, 0)
    await expectNoHorizontalOverflow(page)
    await upload.click()
    await expect(page).toHaveURL('/workspaces/ws_01/meetings/upload')
  })
}

async function openDashboard(
  page: Page,
  scenario: 'dashboard-default' | 'dashboard-member' | 'dashboard-recent-overflow',
) {
  await page.clock.setFixedTime(new Date('2026-09-18T09:00:00+09:00'))
  await start(page, scenario, DASHBOARD)
  await expect(page.getByRole('list', { name: '최근 반영 목록' })).toBeVisible(FIRST_PAINT)
}

function recentRow(page: Page, title: string) {
  return page.getByTestId('recent-row').filter({ hasText: title })
}

test('PM 은 확인 필요·마감 임박에서 상세와 같은 조건의 목록으로 간다', async ({ page }) => {
  await openDashboard(page, 'dashboard-default')
  await expect(page.getByText('확인이 필요한 일이 있어요')).toBeVisible()
  const summary = page.getByRole('definition')
  await expect(summary).toHaveText(['3', '2', '4', '1'])

  // 확인 필요 → 확인 필요 상세 (D-162)
  await page.getByRole('link', { name: '확인하기 — 테스트 계획 정리' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/approvals/ap_02')
  await page.goBack()
  await expect(page).toHaveURL(DASHBOARD)

  // 마감 임박 5건, 기한 지남이 먼저다. 전체 보기 → 같은 6건의 목록
  const due = page.getByRole('list', { name: '마감 임박 목록' }).getByRole('link')
  await expect(due).toHaveCount(5, FIRST_PAINT)
  await expect(due.first()).toContainText('기한 지남')
  await page.getByRole('link', { name: '전체 보기' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/tasks?tab=in_progress&due=overdue,soon')
  await expect(page.getByRole('tab', { name: /^진행 중/ })).toHaveAttribute(
    'aria-selected',
    'true',
    FIRST_PAINT,
  )
  await expect(page.getByRole('list', { name: '태스크 목록' }).getByRole('link')).toHaveCount(6)
  await page.goBack()

  // 행 전체가 태스크 상세 링크다 (D-047)
  await page
    .getByRole('list', { name: '마감 임박 목록' })
    .getByRole('link', { name: /STT 정확도 측정/ })
    .click()
  await expect(page).toHaveURL('/workspaces/ws_01/tasks/tk_06')
})

test('키보드로 되돌리기를 열고 닫고, 확인하면 행이 `되돌림` 과 새 확인 필요 링크가 된다', async ({
  page,
}) => {
  await openDashboard(page, 'dashboard-default')
  const button = page.getByRole('button', { name: 'DB 스키마 정리 되돌리기' })
  await button.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeInViewport({ ratio: 1 })
  // 모달 안에 포커스가 있고, Esc 로 닫으면 연 버튼으로 돌아온다 (AC-06)
  await expect(dialog.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(button).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '되돌리기' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  const row = recentRow(page, 'DB 스키마 정리')
  await expect(row).toContainText('되돌림')
  // 포커스는 body 로 떨어지지 않고 그 행의 새 확인 필요 보기 링크에 있다 (E-04). Enter 로 바로 이어 갈 수 있다
  const reviewLink = row.getByRole('link', { name: /^확인 필요 보기/ })
  await expect(reviewLink).toBeFocused()
  // 행은 자리를 지킨다 — 세 번째 그대로다
  await expect(page.getByTestId('recent-row').nth(2)).toContainText('DB 스키마 정리')
  await expect(page.getByText('자동 반영을 되돌렸어요').first()).toBeVisible()
  // 새 확인 필요가 확인 필요 목록에도 생긴다
  await expect(page.getByRole('link', { name: '확인하기 — DB 스키마 정리' })).toBeVisible()
  await reviewLink.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/workspaces\/ws_01\/approvals\/ap_\d+$/)
})

test('막힌 일은 목록의 막힘 조건으로, 채워 넣기는 첫 빈 칸에 포커스를 둔 상세로 간다. 새로고침하면 포커스를 옮기지 않는다 (D-176)', async ({
  page,
}) => {
  await openDashboard(page, 'dashboard-default')
  await page.getByRole('link', { name: '막힌 일 1' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/tasks?tab=in_progress&due=blocked')
  await expect(page.getByRole('list', { name: '태스크 목록' }).getByRole('link')).toHaveText(
    ['DB 스키마 정리'],
    FIRST_PAINT,
  )
  await page.goBack()

  await page.getByRole('link', { name: '채워 넣기 — 알림 문구 검토' }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/approvals/ap_01')
  const assignee = page.getByRole('combobox', { name: '담당자 · 미정' })
  await expect(assignee).toBeFocused(FIRST_PAINT)

  await page.reload()
  await expect(assignee).toBeEnabled(FIRST_PAINT)
  await expect(assignee).not.toBeFocused()

  // 뒤로 갔다 앞으로 와도 포커스를 옮기지 않는다
  await page.goBack()
  await expect(page).toHaveURL(DASHBOARD)
  await page.goForward()
  await expect(assignee).toBeEnabled(FIRST_PAINT)
  await expect(assignee).not.toBeFocused()
})

/** 보이는 최근 반영 행 수와 마지막 행 아래 끝(문서 기준), 행 평균 높이 */
async function recentLayout(page: Page) {
  return page.getByTestId('recent-row').evaluateAll((rows) => {
    const boxes = rows.map((row) => row.getBoundingClientRect())
    const last = boxes[boxes.length - 1]
    return {
      count: rows.length,
      bottom: last.bottom + window.scrollY,
      rowHeight: boxes.reduce((sum, box) => sum + box.height, 0) / boxes.length,
    }
  })
}

/** 첫 화면에 들어가는 만큼이다 — 마지막 행 아래에 `외 N건` 줄(32px)까지 들어가고, 한 행 더는 들어가지 않는다 */
async function expectRecentFits(page: Page, height: number) {
  const more = page.getByRole('link', { name: /^외 \d+건 · 회의록에서 보기$/ })
  await expect(more).toBeVisible(FIRST_PAINT)
  const { count, bottom, rowHeight } = await recentLayout(page)
  expect(count).toBeGreaterThanOrEqual(3)
  expect(count).toBeLessThanOrEqual(8)
  await expect(more).toHaveText(`외 ${12 - count}건 · 회의록에서 보기`)
  if (count > 3) expect(bottom + 32).toBeLessThanOrEqual(height)
  if (count < 8) expect(bottom + rowHeight + 32).toBeGreaterThan(height)
  return count
}

test('최근 반영은 첫 화면에 들어가는 만큼 보이고, 넘친 수는 회의록으로 이어진다 (D-176)', async ({
  page,
}) => {
  await openDashboard(page, 'dashboard-recent-overflow')
  // 위 영역(요약·마감 임박)이 다 그려진 뒤에 잰 값을 본다
  await expect(page.getByRole('list', { name: '마감 임박 목록' }).getByRole('link')).toHaveCount(
    5,
    FIRST_PAINT,
  )
  await expect(page.getByRole('definition')).toHaveText(['3', '2', '4', '1'])
  await expect(async () => {
    await expectRecentFits(page, 900)
  }).toPass()
  const at900 = (await recentLayout(page)).count

  await page.setViewportSize({ width: 1280, height: 1080 })
  await expect(async () => {
    const at1080 = await expectRecentFits(page, 1080)
    expect(at1080).toBeGreaterThan(at900)
  }).toPass()

  // 스크롤로는 다시 재지 않는다
  const before = (await recentLayout(page)).count
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(200)
  expect((await recentLayout(page)).count).toBe(before)

  await page.getByRole('link', { name: /^외 \d+건 · 회의록에서 보기$/ }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/meetings/mt_09')
})

test('일반 팀원은 확인 필요·되돌리기가 없고 승인 목록을 부르지 않는다', async ({ page }) => {
  const approvals: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/v1/approvals')) approvals.push(pathname)
  })
  await openDashboard(page, 'dashboard-member')
  await expect(page.getByText('워크스페이스 현황')).toBeVisible()
  await expect(page.getByRole('heading', { name: '확인이 필요한 일' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /되돌리기$/ })).toHaveCount(0)
  await expect(page.getByRole('definition')).toHaveText(['2', '4', '1'])
  expect(approvals).toEqual([])
})

test('로그인돼 있으면 로그인 주소에서 대시보드로 들어온다', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-18T09:00:00+09:00'))
  await start(page, 'dashboard-default', '/login')
  await expect(page).toHaveURL(DASHBOARD, FIRST_PAINT)
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeAttached()
  await expect(page.getByRole('list', { name: '최근 반영 목록' })).toBeVisible(FIRST_PAINT)
})
