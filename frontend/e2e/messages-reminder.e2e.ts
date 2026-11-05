import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #370 — PM 이 메시지 화면의 `새 재촉` 으로 재촉을 만들면 그 보낼 메시지의 보내기 전 확인으로 옮겨 가고,
 * 새로고침 뒤에도 목록에 남는다. 브라우저 MSW 는 시계를 목의 고정 시각(9/18 09:00)에 맞춘다.
 * 고르기·잠금 이유·실패 문구·태스크 상세 진입은 app/reminderCreateMsw.test.tsx 가 본다
 */

test('새 재촉으로 만든 재촉은 보내기 전 확인에 남고 새로고침 뒤에도 그대로다', async ({ page }) => {
  await start(page, 'messages-default', '/workspaces/ws_01/messages')
  await page.getByRole('link', { name: '새 재촉', exact: true }).click()
  await expect(page).toHaveURL(/\/messages\?new=reminder$/)
  await expect(page.getByRole('heading', { level: 2, name: '새 재촉' })).toBeVisible()

  await page.getByLabel('받는 사람').selectOption({ label: '이재환' })
  await page.getByLabel('태스크').selectOption({ label: 'DB 스키마 정리 · 09/22 마감' })
  await expect(page.getByRole('radio', { name: '마감 하루 전09/21 09:00' })).toBeChecked()
  await page.getByRole('button', { name: '재촉 만들기' }).click()

  await expect(page).toHaveURL(/\/messages\?review=bd_03$/)
  await expect(page.getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
  await expect(
    page.getByText('재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.'),
  ).toBeVisible()
  const reviews = page.getByRole('region', { name: /^보내기 전 확인/ })
  await expect(reviews.getByRole('link')).toHaveCount(3)

  await page.reload()
  await expect(page.getByRole('region', { name: /^보내기 전 확인/ }).getByRole('link')).toHaveCount(
    3,
    { timeout: 15_000 },
  )
  await expect(page.getByText('묶은 태스크 1')).toBeVisible()
})
