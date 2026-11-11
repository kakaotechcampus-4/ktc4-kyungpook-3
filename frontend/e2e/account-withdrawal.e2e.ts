import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { agreeToPolicies, confirmUsername, readMailedCode, start } from './support'

const storedStateSchema = z.object({
  db: z.object({
    authenticated: z.boolean(),
    session: z.object({
      user: z.object({ user_id: z.string(), username: z.string(), email: z.string().nullable() }),
      workspace_count: z.number(),
    }),
    accounts: z.array(z.object({ session: z.object({ user: z.object({ user_id: z.string() }) }) })),
    members: z.array(
      z.object({
        member_id: z.string(),
        display_name: z.string(),
        discord_user_id: z.string().nullable(),
      }),
    ),
    tasks: z.array(z.object({ task_id: z.string() })),
    invitations: z.array(z.object({ invited_user_id: z.string() })),
  }),
})

async function readMockState(page: Page) {
  const raw = await page.evaluate(() => sessionStorage.getItem('msw-db'))
  return storedStateSchema.parse(JSON.parse(raw ?? 'null')).db
}

test('마지막 PM 이전부터 탈퇴·정리 상태 복원·같은 이메일 새 계정까지 이어진다', async ({
  page,
}, testInfo) => {
  await start(page, 'team-invitations', '/account/withdrawal')
  await expect(page.getByRole('button', { name: '계정 탈퇴하기' })).toBeDisabled()
  await page.getByRole('link', { name: '팀에서 권한 이전하기' }).click()
  const teammate = page.getByRole('region', { name: '박민수' })
  await teammate.getByRole('button', { name: 'PM 권한 부여' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'PM 권한 부여' }).click()
  await expect(teammate.getByText('PM', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /내 계정:/ }).click()
  await page.getByRole('menuitem', { name: '계정 탈퇴' }).click()
  await expect(page.getByRole('checkbox')).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.screenshot({ path: testInfo.outputPath('withdrawal-confirm.png'), fullPage: true })

  const before = await readMockState(page)
  const beforeEmail = before.session.user.email
  if (beforeEmail === null)
    throw new Error('탈퇴할 픽스처 계정에 이메일이 있어야 같은 이메일로 다시 가입한다')
  await page.getByRole('button', { name: '계정 탈퇴하기' }).click()
  await expect(page.getByRole('heading', { name: '개인정보 정리 중' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('withdrawal-pending.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('heading', { name: '탈퇴 완료' })).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: testInfo.outputPath('withdrawal-complete.png'), fullPage: true })
  const deleted = await readMockState(page)
  expect(deleted.authenticated).toBe(false)
  expect(
    deleted.accounts.some(
      (account) => account.session.user.user_id === before.session.user.user_id,
    ),
  ).toBe(false)
  expect(deleted.members.find((member) => member.member_id === 'mb_01')).toMatchObject({
    display_name: '탈퇴한 사용자',
    discord_user_id: null,
  })
  expect(deleted.tasks.map((task) => task.task_id)).toEqual(
    before.tasks.map((task) => task.task_id),
  )

  await page.getByRole('link', { name: '로그인 화면' }).click()
  await page.getByLabel('이메일').fill('minsu@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')
  await page.goto('/workspaces/ws_01/tasks/tk_01')
  await expect(page.getByRole('heading', { name: '로그인 API 연동' })).toBeVisible()
  await expect(
    page.getByText('탈퇴한 담당자에게는 재촉을 보낼 수 없어요. 새 담당자를 정해 주세요.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '재촉 만들기' })).toHaveCount(0)
  await expect(
    page.getByRole('list', { name: '변경 이력' }).getByText(/탈퇴한 사용자 · 직접 변경/),
  ).toBeVisible()
  await page.getByRole('button', { name: '담당자 수정' }).click()
  await expect(page.getByRole('combobox', { name: '담당자' })).toContainText('탈퇴한 사용자')
  await page.getByRole('combobox', { name: '담당자' }).click()
  await expect(page.getByRole('option', { name: '탈퇴한 사용자' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.screenshot({
    path: testInfo.outputPath('withdrawn-task-and-history.png'),
    fullPage: true,
  })
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '팀', exact: true }).click()
  await expect(page.getByRole('region', { name: '박민수' })).toBeVisible()
  await expect(page.getByRole('region', { name: '탈퇴한 사용자' })).toHaveCount(0)
  await page.getByRole('button', { name: /내 계정:/ }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()
  await expect(page).toHaveURL('/login')
  await page.getByRole('link', { name: '회원가입', exact: true }).click()
  await expect(page.getByRole('heading', { name: '회원가입', exact: true })).toBeVisible()
  await page.getByLabel('이메일').fill(beforeEmail)
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  await confirmUsername(page, 'newaccount1')
  await page.getByLabel('이름').fill('새 계정')
  await page.getByLabel('비밀번호', { exact: true }).fill('new-password123')
  await agreeToPolicies(page)
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')
  await expect(
    page.getByText('PM에게 내 아이디(newaccount1)를 알려 주고 초대를 요청하세요.'),
  ).toBeVisible()
  const fresh = await readMockState(page)
  expect(fresh.session.user.user_id).not.toBe(before.session.user.user_id)
  expect(fresh.session.workspace_count).toBe(0)
  expect(
    fresh.invitations.some(
      (invitation) => invitation.invited_user_id === fresh.session.user.user_id,
    ),
  ).toBe(false)
})

test('모바일에서도 마지막 PM 안내와 권한 이전 링크가 가로 넘침 없이 보인다', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await start(page, 'team-invitations', '/account/withdrawal')
  await expect(page.getByRole('link', { name: '팀에서 권한 이전하기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '계정 탈퇴하기' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: testInfo.outputPath('withdrawal-mobile-blocked.png'),
    fullPage: true,
  })
})
