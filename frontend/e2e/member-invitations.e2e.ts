import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #320 팀원 초대. 메일은 가지 않는다 — 초대받은 사람은 그 이메일로 가입하거나 로그인해 받은 초대를 본다.
 * 검사 순서·오류 문구·역할은 app/teamInvitations.test.tsx·invitationRespond.test.tsx 가 본다. 여기는 브라우저에서
 * 가입부터 수락·입장까지 한 번에 이어지는지와, PM 의 취소·다시 초대가 저장된 모의 db 로 남는지만 본다
 */

test('초대받은 이메일로 가입하면 받은 초대가 보이고, 수락하면 그 워크스페이스 대시보드로 들어간다', async ({
  page,
}) => {
  await start(page, 'invitation-pending', '/signup')
  await page.getByLabel('이름').fill('이재환')
  await page.getByLabel('이메일').fill('jaehwan@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')

  const invitations = page.getByRole('region', { name: '받은 초대' })
  await expect(invitations.getByText('카테캠 3팀')).toBeVisible()
  await expect(invitations.getByText('팀원 이름 이재환 · 초대한 사람 최진호')).toBeVisible()
  await invitations.getByRole('button', { name: '수락' }).click()

  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')
  await page.goto('/workspaces/ws_01/members')
  await expect(page.getByRole('region', { name: '이재환' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '팀원 관리' })).toHaveCount(0)
})

test('PM 이 기다리는 초대를 취소하고 다시 초대하면 새로고침 뒤에도 대기다', async ({ page }) => {
  await start(page, 'team-invitations', '/workspaces/ws_01/members')
  const jaehwan = page.getByRole('region', { name: '이재환' })
  await expect(jaehwan.getByText('대기')).toBeVisible({ timeout: 15_000 })

  await jaehwan.getByRole('button', { name: '초대 취소' }).click()
  await expect(jaehwan.getByText('취소', { exact: true })).toBeVisible()

  await jaehwan.getByRole('button', { name: '다시 초대' }).click()
  const dialog = page.getByRole('dialog', { name: '이재환 초대' })
  await dialog.getByLabel('가입 이메일').fill('jh.lee@example.com')
  await dialog.getByRole('button', { name: '초대하기' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(jaehwan.getByText('대기')).toBeVisible()
  await expect(jaehwan.getByText('jh.lee@example.com')).toBeVisible()

  await page.reload()
  await expect(jaehwan.getByText('jh.lee@example.com')).toBeVisible({ timeout: 15_000 })
  await expect(jaehwan.getByText('대기')).toBeVisible()
})
