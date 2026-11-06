import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #430 첫 방문 인트로의 두 자리. 문구 순서·저장소 실패·세션 경계는 app/firstVisitIntro.test.tsx 가 본다.
 * 여기는 브라우저에서 랜딩을 덮지 않는지, 처음 누를 때만 끼어드는지, 첫 대시보드에서 한 번만 뜨는지를 본다
 */

const intro = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: '매스 소개' })

test('랜딩은 덮지 않고, 처음 누른 `시작하기` 에서만 인트로를 보인 뒤 로그인으로 간다', async ({
  page,
}, testInfo) => {
  await start(page, 'signed-out', '/', { deviceIntroSeen: false })
  await expect(page.getByRole('heading', { level: 1, name: /한 번의 클릭으로/ })).toBeVisible()
  await expect(intro(page)).toHaveCount(0)

  await page.getByRole('banner').getByRole('link', { name: '시작하기' }).click()
  await expect(intro(page)).toBeVisible()
  await expect(intro(page).getByText('안녕하세요, 저는 매스예요.')).toBeVisible()
  await expect(page).toHaveURL('/')
  await testInfo.attach('landing-intro-desktop.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(intro(page).getByRole('button', { name: '건너뛰기' })).toBeInViewport()
  await expect(intro(page).getByRole('button', { name: '시작하기' })).toBeInViewport()
  await testInfo.attach('landing-intro-mobile.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })

  await intro(page).getByRole('button', { name: '건너뛰기' }).click()
  await expect(page).toHaveURL('/login')
  await expect(intro(page)).toHaveCount(0)

  await page.goto('/')
  await page.getByRole('link', { name: '시작하기' }).last().click()
  await expect(page).toHaveURL('/login')
  await expect(intro(page)).toHaveCount(0)
})

test('알림 링크로 온 `/login?next=` 에는 인트로가 없다', async ({ page }) => {
  await start(page, 'signed-out', '/login?next=%2Fworkspaces%2Fws_01%2Ftasks', {
    deviceIntroSeen: false,
  })
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await expect(intro(page)).toHaveCount(0)
})

test('팀원 온보딩에서 공간을 고른 계정은 첫 대시보드에서 한 번 보고, 새로고침하면 다시 보지 않는다', async ({
  page,
}, testInfo) => {
  await start(page, 'single-workspace', '/onboarding/member')
  await page.getByRole('button', { name: /카테캠 3팀/ }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/dashboard')

  await expect(intro(page)).toBeVisible()
  await testInfo.attach('dashboard-intro.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await intro(page).getByRole('button', { name: '시작하기' }).click()
  await expect(intro(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '최근 반영' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '최근 반영' })).toBeVisible()
  await expect(intro(page)).toHaveCount(0)
})
