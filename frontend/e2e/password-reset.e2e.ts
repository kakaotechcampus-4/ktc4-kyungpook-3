import { expect, test } from '@playwright/test'
import { start } from './support'

/* #356 비밀번호 재설정. 메일은 모의 메일함(/__mock/mail)에서 연다 — 링크를 누르면 메일처럼 문서를 새로 연다 */

test('로그인의 `비밀번호를 잊으셨나요?` → 재설정 메일 요청 → 모의 메일함의 링크 → 새 비밀번호 → 새 비밀번호로 로그인', async ({
  page,
}) => {
  await start(page, 'signed-out', '/login')
  await page.getByRole('link', { name: '비밀번호를 잊으셨나요?' }).click()
  await expect(page).toHaveURL('/forgot-password')
  await expect(page.getByRole('heading', { name: '비밀번호 재설정 요청' })).toBeVisible()
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByRole('button', { name: '재설정 링크 보내기' }).click()
  await expect(page.getByRole('status')).toContainText(
    'pm@example.com 주소로 가입한 계정이 있으면 재설정 링크를 보냈어요.',
  )
  await expect(page.getByRole('button', { name: '다시 보내기 (60초)' })).toBeDisabled()

  // 새 문서라 앱·MSW 가 처음부터 다시 뜬다 — 개발 서버가 바쁠 때 기본 5초를 넘길 때가 있다
  await page.goto('/__mock/mail')
  await expect(page.getByRole('heading', { name: '모의 메일함' })).toBeVisible({ timeout: 15_000 })
  await page
    .getByRole('link', { name: /\/reset-password#token=/ })
    .first()
    .click()

  // 토큰은 확인 요청 전에 주소에서 지워진다
  await expect(page.getByLabel('새 비밀번호')).toBeVisible({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByLabel('새 비밀번호').fill('newpass123')
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click()

  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('status')).toHaveText(
    '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.',
  )

  // 안내는 한 번뿐이다. 새로고침과 뒤로가기로 같은 기록 항목에 와도 다시 뜨지 않는다
  await page.reload()
  await expect(page.getByLabel('이메일')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('비밀번호를 바꿨어요')).toHaveCount(0)
  await page.getByRole('link', { name: '회원가입' }).click()
  await expect(page).toHaveURL('/signup')
  await page.goBack()
  await expect(page).toHaveURL('/login')
  await expect(page.getByLabel('이메일')).toBeVisible()
  await expect(page.getByText('비밀번호를 바꿨어요')).toHaveCount(0)

  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('newpass123')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/workspaces')
})

test('시나리오 주소로 만료된 링크를 재현하면 까닭을 보이고 다시 요청하기로 요청 화면에 간다', async ({
  page,
}) => {
  await page.goto('/reset-password?msw-scenario=password-reset-expired#token=mock-reset-expired')
  await expect(page.getByRole('alert')).toContainText('링크 유효 시간(30분)이 지났어요.', {
    timeout: 15_000,
  })
  await expect(page).toHaveURL(/\/reset-password$/)
  await page.getByRole('button', { name: '다시 요청하기' }).click()
  await expect(page).toHaveURL('/forgot-password')
})

for (const [scenario, token, reason] of [
  ['password-reset-used', 'mock-reset-used', '이미 사용한 링크예요.'],
  [
    'password-reset-invalid',
    'mock-reset-revoked',
    '쓸 수 없는 링크예요. 다시 요청했다면 가장 최근 메일의 링크를 열어 주세요.',
  ],
] as const) {
  test(`시나리오 ${scenario} 의 링크는 까닭을 보이고 새 비밀번호 칸이 없다`, async ({ page }) => {
    await page.goto(`/reset-password?msw-scenario=${scenario}#token=${token}`)
    await expect(page.getByRole('alert')).toContainText(reason, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/reset-password$/)
    await expect(page.getByLabel('새 비밀번호')).toHaveCount(0)
  })
}

test('규칙에 어긋난 새 비밀번호는 보내지 않고 칸 아래에 알린다. 고치면 같은 링크로 바뀐다', async ({
  page,
}) => {
  const confirms: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/auth/password-reset/confirm')) confirms.push(request.url())
  })
  await page.goto('/reset-password?msw-scenario=password-reset#token=mock-reset-normal')
  const field = page.getByLabel('새 비밀번호')
  await expect(field).toBeVisible({ timeout: 15_000 })

  await field.fill('abcdefgh')
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription(
    '8자 이상, 숫자 포함 비밀번호는 8자 이상이고 숫자를 포함해야 해요.',
  )
  await expect(page).toHaveURL(/\/reset-password$/)
  expect(confirms).toEqual([])

  await field.fill('newpass123')
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('status')).toHaveText(
    '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.',
  )
  expect(confirms).toHaveLength(1)
})

test('서버가 메일을 보낼 수 없으면 요청 화면에 503 안내를 띄우고 폼에 남는다', async ({ page }) => {
  await page.goto('/forgot-password?msw-scenario=password-reset-mail-unavailable')
  await expect(page.getByLabel('이메일')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByRole('button', { name: '재설정 링크 보내기' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    '지금은 메일을 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요.',
  )
  await expect(page).toHaveURL('/forgot-password')
  await expect(page.getByRole('button', { name: '재설정 링크 보내기' })).toBeEnabled()
})
