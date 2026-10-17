import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { start } from './support'

/*
 * M7 §5 — 대시보드의 핵심 이동·되돌리기·키보드 (AC-02 · AC-04 · AC-06). 상태는 MSW 시나리오(shared/mock/scenarios.ts)로만 만든다.
 * 오늘은 픽스처의 서울 오늘(2026-09-18 09:00 KST)로 고정한다 — 시계만 멈추고 타이머는 그대로 간다.
 * 실제 서버의 되돌리기·Notion 페이지 보관은 여기서 검증하지 않는다(별도 연동 과제).
 *
 * - dashboard-default: ws_01 의 PM. 대기 승인 3건(ap_01 보류 · ap_02 · ap_03), 마감 임박 6건, 최근 반영 3건(모두 반영 완료)
 * - dashboard-member: 같은 공간의 일반 팀원
 */

test.describe.configure({ timeout: 60_000 })

const FIRST_PAINT = { timeout: 15_000 }
const DASHBOARD = '/workspaces/ws_01/dashboard'

async function openDashboard(page: Page, scenario: 'dashboard-default' | 'dashboard-member') {
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
