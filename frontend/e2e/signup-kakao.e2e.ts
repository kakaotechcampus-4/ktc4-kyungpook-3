import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readMailedCode, start } from './support'

/*
 * #427 가입 이메일 인증과 카카오 로그인. 세부 문구와 오류 갈래는 app/signupFlow.test.tsx·kakaoLogin.test.tsx 가 본다.
 * 여기는 실제 브라우저의 전체 이동(모의 카카오 왕복, 새 문서 복귀)과 저장된 모의 db 로 이어지는지 본다
 */

const NEW_EMAIL = 'kakao-new@example.com'

async function chooseOnMockKakao(page: Page, choice: string): Promise<void> {
  await expect(page).toHaveURL(/\/__mock\/kakao/)
  await expect(page.getByRole('heading', { name: '모의 카카오 로그인' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: choice }).click()
}

async function startKakaoLogin(page: Page, choice: string): Promise<void> {
  await start(page, 'signed-out', '/login')
  await page.getByRole('button', { name: '카카오로 로그인' }).click()
  await chooseOnMockKakao(page, choice)
}

test('이메일 가입: 코드를 틀려도 남은 횟수를 보이고, 맞는 코드로 가입이 끝난다', async ({
  page,
}) => {
  await start(page, 'signed-out', '/signup')
  await page.getByLabel('이메일').fill('new@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await expect(page.getByLabel('인증 코드')).toBeVisible()

  const code = await readMailedCode(page)
  await page.getByLabel('인증 코드').fill(code === '000000' ? '000001' : '000000')
  await page.getByRole('button', { name: '코드 확인' }).click()
  await expect(page.getByText('코드가 맞지 않아요. 4번 더 입력할 수 있어요.')).toBeVisible()

  await page.getByLabel('인증 코드').fill(code)
  await page.getByRole('button', { name: '코드 확인' }).click()
  await expect(page.getByLabel('이메일')).toHaveValue('new@example.com')
  await page.getByLabel('이름').fill('새 사용자')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByLabel('비밀번호', { exact: true }).press('Enter')
  await expect(page).toHaveURL('/onboarding/start')
})

test('모의 메일함의 코드를 보고 돌아와 같은 이메일을 넣으면 코드 단계로 이어진다', async ({
  page,
}) => {
  await start(page, 'signed-out', '/signup')
  await page.getByLabel('이메일').fill('new@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await expect(page.getByLabel('인증 코드')).toBeVisible()
  const code = await readMailedCode(page)

  await page.goto('/__mock/mail')
  await expect(page.getByText(code)).toBeVisible({ timeout: 15_000 })
  await page.goto('/signup')

  await page.getByLabel('이메일').fill('new@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await page.getByLabel('인증 코드').fill(code)
  await page.getByRole('button', { name: '코드 확인' }).click()
  await expect(page.getByLabel('이름')).toBeVisible()
})

/** 모의 서버는 응답 뒤에 sessionStorage 로 저장해서, 바로 옮기면 로그인 상태가 복원될 수 있다 */
async function logOutToLogin(page: Page) {
  await expect(async () => {
    await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' }))
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '카카오로 로그인' })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

test('카카오 새 사용자: 잠긴 이메일로 가입하면 다음에는 이메일과 카카오 둘 다 로그인된다', async ({
  page,
}) => {
  await startKakaoLogin(page, '새 사용자 (이메일 있음)')

  await expect(page).toHaveURL('/signup?kakao=1')
  await expect(page.getByLabel('이메일')).toHaveValue(NEW_EMAIL, { timeout: 15_000 })
  await expect(page.getByLabel('이메일')).toHaveAttribute('readonly')
  await expect(page.getByLabel('이름')).toHaveValue('카카오 새 사용자')

  // 메일 앱을 다녀오듯 새로고침해도 카카오 연결 모드가 남는다
  await page.reload()
  await expect(page.getByLabel('이메일')).toHaveValue(NEW_EMAIL, { timeout: 15_000 })

  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')

  await logOutToLogin(page)
  await page.getByLabel('이메일').fill(NEW_EMAIL)
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL('/onboarding/start')

  await logOutToLogin(page)
  await page.getByRole('button', { name: '카카오로 로그인' }).click()
  await chooseOnMockKakao(page, '새 사용자 (이메일 있음)')
  await expect(page).toHaveURL('/onboarding/start', { timeout: 15_000 })
})

test('카카오 이메일 없음: 코드 인증 뒤 가입하면 입력한 이메일 계정에 카카오가 이어진다', async ({
  page,
}) => {
  await startKakaoLogin(page, '새 사용자 (이메일 없음)')
  await expect(page.getByText('가입을 마치면 카카오 계정이 연결돼요.')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByLabel('이메일').fill('no-email@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await expect(page.getByLabel('인증 코드')).toBeVisible()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  await expect(page.getByLabel('이름')).toHaveValue('이메일 없는 사용자')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')

  const store = await page.evaluate(() => sessionStorage.getItem('msw-db'))
  const account = (
    JSON.parse(store ?? '{}') as {
      db: { accounts: { kakaoId?: string; session: { user: { email: string } } }[] }
    }
  ).db.accounts.at(-1)
  expect(account?.session.user.email).toBe('no-email@example.com')
  expect(account?.kakaoId).toBe('kakao-no-email')
})

test('이메일 충돌: 로그인 화면이 안내하고 주소에서 결과를 지운다', async ({ page }) => {
  await startKakaoLogin(page, '이메일 충돌')
  await expect(page.getByRole('alert')).toHaveText(
    '이미 가입된 이메일이에요. 이메일로 로그인해 주세요.',
    { timeout: 15_000 },
  )
  await expect(page).toHaveURL('/login')
  await page.reload()
  await expect(page.getByLabel('이메일')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('취소: 조용한 안내를 보이고 로그인 화면에 머문다', async ({ page }) => {
  await startKakaoLogin(page, '취소')
  await expect(page.getByRole('status')).toHaveText('카카오 로그인을 취소했어요.', {
    timeout: 15_000,
  })
  await expect(page).toHaveURL('/login')
})

test('이어진 계정의 카카오 로그인은 이메일 로그인과 같은 곳으로 간다', async ({ page }) => {
  await startKakaoLogin(page, '이어진 계정으로 로그인')
  await expect(page).toHaveURL('/workspaces', { timeout: 15_000 })
})
