import { expect, test } from '@playwright/test'
import { capture, start } from './support'

test('PM 회의 삭제 → 남은 태스크 → 새로고침 → 삭제된 원본 링크', async ({ page }, info) => {
  await start(page, 'tasks-default', '/workspaces/ws_01/meetings/mt_09')
  await expect(page.getByRole('heading', { name: '3주차 정기회의', level: 2 })).toBeVisible()
  let deletes = 0
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes += 1
  })
  await page.getByRole('button', { name: '회의 삭제', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('태스크는 남아요')
  await capture(page, info, 'meeting-delete-confirm.png')
  await page.getByRole('button', { name: '취소', exact: true }).click()
  expect(deletes).toBe(0)
  await page.getByRole('button', { name: '회의 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제하기', exact: true }).click()
  await expect(
    page
      .getByTestId('toast-dock')
      .getByText('회의를 삭제했어요. 남은 파일을 정리하고 있어요.', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: '회의 목록' })
      .getByRole('link', { name: /3주차 정기회의/ }),
  ).toHaveCount(0)
  expect(deletes).toBe(1)
  await page.goto('/workspaces/ws_01/tasks/tk_01')
  await expect(page.getByText('원본 회의가 삭제되어 근거를 볼 수 없음')).toBeVisible()
  await expect(page.getByRole('heading', { name: '변경 이력', exact: true })).toBeVisible()
  await capture(page, info, 'meeting-delete-task-preserved.png')
  await page.reload()
  await expect(page.locator('.splash')).toHaveCount(0)
  await expect(page.getByText('원본 회의가 삭제되어 근거를 볼 수 없음')).toBeVisible()
  await expect(page.getByRole('link', { name: /에서 나온 일/ })).toHaveCount(0)
  await page.goto('/workspaces/ws_01/meetings/mt_09')
  await expect(page.getByRole('heading', { name: '삭제된 회의예요' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '3주차 정기회의', level: 2 })).toHaveCount(0)
  await capture(page, info, 'meeting-delete-old-link.png')
})

test('팀원과 처리 중 회의는 삭제 진입이 없다', async ({ page }) => {
  await start(page, 'tasks-member', '/workspaces/ws_01/meetings/mt_09')
  await expect(page.getByRole('heading', { name: '3주차 정기회의', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: '회의 삭제', exact: true })).toHaveCount(0)
  await start(page, 'tasks-default', '/workspaces/ws_01/meetings/mt_10')
  await expect(page.getByRole('link', { name: '정리 상태 보기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '회의 삭제', exact: true })).toHaveCount(0)
})
