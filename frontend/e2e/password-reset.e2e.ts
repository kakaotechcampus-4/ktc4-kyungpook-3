import { expect, test } from '@playwright/test'
import { start } from './support'

/* #356 비밀번호 재설정. 메일은 모의 메일함(/__mock/mail)에서 연다 — 링크를 누르면 메일처럼 문서를 새로 연다 */

test('재설정 메일 요청 → 모의 메일함의 링크 → 새 비밀번호 → 새 비밀번호로 로그인', async ({
  page,
}) => {
  await start(page, 'signed-out', '/forgot-password')
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
