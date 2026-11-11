import { expect, test } from '@playwright/test'
import {
  capture,
  expectAudioReady,
  expectMinutesOpened,
  expectNoHorizontalOverflow,
  SHORT_AUDIO,
  start,
} from './support'

const DOCUMENTS = [
  { path: '/terms', title: '이용약관' },
  { path: '/privacy', title: '개인정보처리방침' },
]
const NOTICE =
  '회의록을 만들기 위해 음성과 전사 내용을 외부 서비스(Elice, pyannoteAI)로 보내요. 참석자에게 알린 뒤 올려 주세요.'

for (const { path, title } of DOCUMENTS) {
  test(`랜딩 하단의 ${title}을 열고 새로고침해도 게시한 같은 판본을 읽는다`, async ({
    page,
  }, testInfo) => {
    await start(page, 'signed-out')
    await page.getByRole('contentinfo').getByRole('link', { name: title }).click()
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByText('문서를 준비하고 있어요.')).toHaveCount(0)
    await expect(page.getByText('판본 2026-11-10 · 시행일 2026-11-10')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page).toHaveURL(path)
    await expect(page.getByText('판본 2026-11-10 · 시행일 2026-11-10')).toBeVisible()
    await expect(page.locator('.splash')).toHaveCount(0)
    await capture(page, testInfo, 'policy-from-footer.png')
  })

  test(`비로그인으로 ${path}에 직접 들어가 문서를 읽는다`, async ({ page }) => {
    await start(page, 'signed-out', path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: '정책 문서' }).getByRole('link', { name: title }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page).toHaveURL(path)
  })
}

test('로그인한 사용자도 두 문서 주소에서 대시보드로 보내지지 않는다', async ({ page }) => {
  await start(page, 'single-workspace', '/terms')
  for (const { path, title } of DOCUMENTS) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page).toHaveURL(path)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page).toHaveURL(path)
  }
})

test('휴대폰 폭에서도 문서를 읽고 키보드로 두 문서 사이를 이동한다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await start(page, 'signed-out', '/terms')
  await expectNoHorizontalOverflow(page)
  const navigation = page.getByRole('navigation', { name: '정책 문서' })
  const privacy = navigation.getByRole('link', { name: '개인정보처리방침' })
  await privacy.focus()
  await expect(privacy).toBeFocused()
  await privacy.press('Enter')
  await expect(page).toHaveURL('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '개인정보처리방침' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await capture(page, testInfo, 'policy-mobile.png')
  await navigation.getByRole('link', { name: '이용약관' }).click()
  await expect(page).toHaveURL('/terms')
})

test('외부 전송 안내를 읽고 추가 동의 체크 없이 회의를 올린다', async ({ page }, testInfo) => {
  await start(page, 'meeting-instant', '/workspaces/ws_01/meetings/upload')
  const submit = page.getByRole('button', { name: '정리 시작하기' })
  await expect(page.getByText(NOTICE)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /동의/ })).toHaveCount(0)
  await capture(page, testInfo, 'upload-processing-notice.png')

  await page.getByLabel('녹음 파일').setInputFiles(SHORT_AUDIO.path)
  await expectAudioReady(page)
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await page.getByRole('menuitem', { name: '박민수' }).click()
  await submit.click()
  await expectMinutesOpened(page)
  await expect(
    page
      .getByRole('article', { name: SHORT_AUDIO.name })
      .getByRole('heading', { name: SHORT_AUDIO.name }),
  ).toBeVisible({ timeout: 15_000 })
})
