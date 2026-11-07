import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #340 — 설정의 알림 절이 메시지·알림 설정 API 로 저장된다. PM 이 바꾼 값은 새로고침 뒤에도 남고, 일반 팀원은 읽기만 한다.
 * 브라우저에서만 볼 수 있는 것만 둔다 — 새 문서로 다시 읽은 저장 값. 요청 본문·실패 되돌리기·문구 분기는
 * app/settingsPage.test.tsx 가 본다. 메시지 화면의 보낼 시각은 D-117 에 따라 E2E 에 넣지 않는다
 */

const SETTINGS = '/workspaces/ws_01/settings'

test('PM 이 재촉 토글과 재촉 규칙을 바꾸면 새로고침 뒤에도 그대로다', async ({ page }) => {
  await start(page, 'settings-unmapped', SETTINGS)
  const reminder = page.getByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' })
  await expect(reminder).toBeChecked()

  await page.getByRole('combobox', { name: '재촉 며칠 전' }).click()
  await page.getByRole('option', { name: '2일 전', exact: true }).click()
  await page.getByRole('combobox', { name: '재촉 보낼 시각' }).click()
  await page.getByRole('option', { name: '18:00', exact: true }).click()
  const renamed = page.getByRole('switch', { name: '마감 2일 전 18:00에 담당자에게 DM' })
  await expect(renamed).toBeChecked()
  await renamed.click()
  await expect(renamed).not.toBeChecked()

  await page.reload()
  const reloaded = page.getByRole('switch', { name: '마감 2일 전 18:00에 담당자에게 DM' })
  await expect(reloaded).not.toBeChecked({ timeout: 15_000 })
  await expect(page.getByRole('combobox', { name: '재촉 며칠 전' })).toHaveText('2일 전')
  await expect(page.getByRole('combobox', { name: '재촉 보낼 시각' })).toHaveText('18:00')
})

test('일반 팀원은 저장된 알림 설정을 읽기만 한다', async ({ page }) => {
  await start(page, 'settings-member', SETTINGS)
  await expect(
    page.getByRole('switch', { name: '마감 하루 전 09:00에 담당자에게 DM' }),
  ).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '재촉 며칠 전' })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: '재촉 보낼 시각' })).toBeDisabled()
  await expect(page.getByRole('radio', { name: /둘 다/ })).toBeDisabled()
})
