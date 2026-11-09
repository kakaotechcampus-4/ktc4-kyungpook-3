import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { agreeToPolicies, readMailedCode, start } from './support'

const savedConsentSchema = z.object({
  db: z.object({
    session: z.object({ user: z.object({ user_id: z.string() }) }),
    consents: z.array(z.object({ user_id: z.string(), kind: z.string(), version: z.string() })),
  }),
})

async function readSavedConsents(page: Page) {
  return savedConsentSchema.parse(
    await page.evaluate((): unknown => JSON.parse(sessionStorage.getItem('msw-db') ?? '{}')),
  ).db
}

test('게시한 실제 판본은 가입 전 두 동의를 받고 새로고침 후에도 보존한다', async ({ page }) => {
  await start(page, 'signed-out', '/signup')
  await page.getByLabel('이메일').fill('published@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  await page.getByLabel('이름').fill('공개 정책 사용자')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  const submit = page.getByRole('button', { name: '계정 만들기' })
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }).check()
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의', exact: true }).check()
  await submit.click()
  await expect(page).toHaveURL('/onboarding/start')
  await page.reload()
  await expect(page).toHaveURL('/onboarding/start')
  const saved = await readSavedConsents(page)
  const rows = saved.consents.filter((row) => row.user_id === saved.session.user.user_id)
  expect(rows.map((row) => [row.kind, row.version]).sort()).toEqual([
    ['privacy', '2026-11-10'],
    ['terms', '2026-11-10'],
  ])
})

test('초안에 동의한 기존 사용자도 게시 판본에 다시 동의해야 업무 화면을 연다', async ({ page }) => {
  await start(page, 'policy-reconsent', '/workspaces/ws_01/settings')
  await expect(page.getByRole('heading', { name: '서비스 이용 동의' })).toBeVisible()
  const submit = page.getByRole('button', { name: '동의하고 계속하기' })
  await expect(submit).toBeDisabled()
  await agreeToPolicies(page)
  await submit.click()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '서비스 이용 동의' })).toHaveCount(0)
  const saved = await readSavedConsents(page)
  expect(saved.consents.filter((row) => row.version === '2026-11-08')).toHaveLength(2)
  expect(saved.consents.filter((row) => row.version === '2026-11-10')).toHaveLength(2)
})
