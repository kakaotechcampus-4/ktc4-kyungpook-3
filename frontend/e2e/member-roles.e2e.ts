import { expect, test } from '@playwright/test'
import { start } from './support'

test('PM이 로그인 연결된 팀원을 PM으로 올리면 새로고침 뒤에도 역할이 유지된다', async ({
  page,
}, testInfo) => {
  await start(page, 'team-invitations', '/workspaces/ws_01/members')
  const member = page.getByRole('region', { name: '박민수' })
  await expect(member.getByRole('button', { name: 'PM 권한 부여' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: '이재환' }).getByRole('button', { name: 'PM 권한 부여' }),
  ).toHaveCount(0)

  await member.getByRole('button', { name: 'PM 권한 부여' }).click()
  const dialog = page.getByRole('dialog', { name: '박민수에게 PM 권한을 부여할까요?' })
  await expect(dialog.getByText(/내 PM 권한은 유지돼요/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('pm-promotion-confirm.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'PM 권한 부여' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(member.getByText('PM', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('region', { name: '김서연' }).getByText('PM', { exact: true }),
  ).toBeVisible()

  await page.reload()
  await expect(member.getByText('PM', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(member.getByRole('button', { name: 'PM 권한 부여' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '팀원 관리' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('pm-promoted.png'), fullPage: true })
})
