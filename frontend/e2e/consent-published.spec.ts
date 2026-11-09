import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readMailedCode, start } from './support'

const gate = (page: Page) => page.getByRole('heading', { name: '서비스 이용 동의' })
async function accept(page: Page) {
  await page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }).check()
  await page.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의', exact: true }).check()
  await page.getByRole('button', { name: '동의하고 계속하기' }).click()
}
async function rows(page: Page) {
  return page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('msw-db') ?? '{}') as {
      db?: { consents?: { user_id: string; kind: string; version: string; agreed_at: string }[] }
    }
    return saved.db?.consents ?? []
  })
}

test('공개 문서 확인 → 두 체크 → 정확한 계정과 판본 저장 → 원래 주소, 새로고침에도 유지', async ({
  page,
}, testInfo) => {
  let postBody: unknown
  let expectedAccount: string | undefined
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/consents') && request.method() === 'POST') {
      postBody = request.postDataJSON()
      expectedAccount = request.headers()['x-consent-account-id']
    }
  })
  await start(page, 'consent-required', '/workspaces/ws_01/settings')
  await expect(gate(page)).toBeVisible()
  await expect(page.getByRole('button', { name: '동의하고 계속하기' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('published-gate.png'), fullPage: true })
  const popupEvent = page.waitForEvent('popup')
  await page.getByRole('link', { name: '이용약관 보기 (새 탭)' }).click()
  const popup = await popupEvent
  await expect(popup.getByText('테스트 이용약관', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(popup.getByText('test-terms-v1', { exact: false })).toBeVisible()
  await page.bringToFront()
  await accept(page)
  await expect(gate(page)).toHaveCount(0)
  await expect(page).toHaveURL('/workspaces/ws_01/settings')
  await expect.poll(() => rows(page)).toHaveLength(2)
  expect(postBody).toEqual({ terms_version: 'test-terms-v1', privacy_version: 'test-privacy-v1' })
  expect(expectedAccount).toBe('us_01')
  expect(await rows(page)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ user_id: 'us_01', kind: 'terms', version: 'test-terms-v1' }),
      expect.objectContaining({ user_id: 'us_01', kind: 'privacy', version: 'test-privacy-v1' }),
    ]),
  )
  await page.reload()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await expect(gate(page)).toHaveCount(0)
})

for (const scenario of ['consent-write-error', 'consent-response-lost'] as const) {
  test(`${scenario}: 실패와 응답 유실을 저장 결과로 구분한다`, async ({ page }) => {
    await start(page, scenario, '/workspaces/ws_01/settings')
    await expect(gate(page)).toBeVisible()
    await accept(page)
    if (scenario === 'consent-response-lost') {
      await expect(gate(page)).toHaveCount(0)
      await expect.poll(() => rows(page)).toHaveLength(2)
    } else {
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(
        page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }),
      ).not.toBeChecked()
      expect(await rows(page)).toEqual([])
    }
  })
}

for (const scenario of ['consent-mismatch', 'consent-read-error'] as const) {
  test(`${scenario}: 업무 화면과 수집을 차단한다`, async ({ page }) => {
    await start(page, scenario, '/workspaces/ws_01/settings')
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: '동의하고 계속하기' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toHaveCount(0)
    expect(await rows(page)).toEqual([])
  })
}

test('이메일 가입은 체크 전 계정을 만들지 않고 가입 뒤 정확한 새 계정에만 기록한다', async ({
  page,
}) => {
  await start(page, 'consent-signup', '/signup')
  await page.getByLabel('이메일').fill('consent-new@example.com')
  await page.getByRole('button', { name: '인증 코드 받기' }).click()
  await page.getByLabel('인증 코드').fill(await readMailedCode(page))
  await page.getByRole('button', { name: '코드 확인' }).click()
  await page.getByLabel('이름').fill('동의 사용자')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await expect(page.getByRole('button', { name: '계정 만들기' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }).check()
  await page.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의', exact: true }).check()
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')
  await expect.poll(() => rows(page)).toHaveLength(2)
  const stored = await rows(page)
  expect(stored.every((row) => row.user_id !== 'us_01')).toBe(true)
  await page.reload()
  await expect(gate(page)).toHaveCount(0)
})

test('카카오 가입도 같은 두 필수 동의와 문서 링크를 쓴다', async ({ page }) => {
  await start(page, 'consent-signup', '/login')
  await page.getByRole('button', { name: '카카오 로그인' }).click()
  await expect(page.getByRole('heading', { name: '모의 카카오 로그인' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '새 사용자 (이메일 있음)', exact: true }).click()
  await expect(page.getByLabel('이름')).toHaveValue('카카오 새 사용자', { timeout: 15_000 })
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await expect(page.getByRole('button', { name: '계정 만들기' })).toBeDisabled()
  await expect(page.getByRole('link', { name: '개인정보처리방침 보기 (새 탭)' })).toBeVisible()
  await page.getByRole('checkbox', { name: '[필수] 이용약관 동의', exact: true }).check()
  await page.getByRole('checkbox', { name: '[필수] 개인정보처리방침 동의', exact: true }).check()
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')
  await expect.poll(() => rows(page)).toHaveLength(2)
  expect((await rows(page)).every((row) => row.user_id !== 'us_01')).toBe(true)
})
