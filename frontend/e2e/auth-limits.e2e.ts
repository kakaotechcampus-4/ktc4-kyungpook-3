import { expect, test } from '@playwright/test'
import { capture, readMailedCode, start } from './support'

/* #446 가입 이름 100자, #457 로그인 시도 제한 429. 문구와 요청 유무만 본다. 규칙의 전체 경우는 Vitest 가 본다 */

test('101자 이름은 가입 폼에서 막히고 가입 요청을 보내지 않는다', async ({ page }, testInfo) => {
  const signups: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/auth/signup'))
      signups.push(request.url())
  })
  await start(page, 'signed-out', '/signup')
  await page.getByLabel('이메일').fill('long-name@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  const name = page.getByLabel('이름')
  await name.fill('가'.repeat(101))
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '계정 만들기' }).click()

  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(name).toHaveAccessibleDescription('이름은 100자 이하로 입력해 주세요.')
  await expect(name).toBeFocused()
  await expect(page).toHaveURL('/signup')
  await capture(page, testInfo, 'signup-name-101.png')

  await name.fill('가'.repeat(100))
  await expect(name).not.toHaveAttribute('aria-invalid')
  expect(signups).toEqual([])
})

test('시도 제한에 걸린 로그인은 맞는 비밀번호여도 서버 문구를 보이고 남은 시간은 보이지 않는다', async ({
  page,
}, testInfo) => {
  await start(page, 'login-rate-limited', '/login')
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  const response = page.waitForResponse('**/api/v1/auth/login')
  await page.getByRole('button', { name: '로그인', exact: true }).click()

  const answered = await response
  expect(answered.status()).toBe(429)
  expect(answered.headers()['retry-after']).toBe('900')
  await expect(page.getByRole('alert')).toHaveText(
    '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  )
  await expect(page.getByText(/\d+\s*(초|분)/)).toHaveCount(0)
  await expect(page.getByText(/잠겼|잠금/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: '비밀번호를 잊으셨나요?' })).toHaveAttribute(
    'href',
    '/forgot-password',
  )
  await expect(page).toHaveURL('/login')
  await capture(page, testInfo, 'login-429.png')
})
