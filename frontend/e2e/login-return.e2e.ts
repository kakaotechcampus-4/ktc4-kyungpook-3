import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { capture, start } from './support'

/*
 * #411 ① 비로그인으로 연 보호 주소(푸시로 연 대화·태스크)는 로그인 뒤 그곳으로 돌아간다. 앱 밖 주소로는 보내지 않고,
 * 직접 로그아웃하면 돌아갈 경로를 붙이지 않는다. 걸러 내는 값의 전체 목록은 shared/lib/return-path 단위 테스트가 본다
 */

async function logIn(page: Page) {
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible()
  await page.getByLabel('이메일').fill('pm@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('mock-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}

test('비로그인으로 연 대화는 로그인 뒤 그 대화로 돌아간다', async ({ page }, testInfo) => {
  await start(page, 'signed-out', '/workspaces/ws_01/messages/threads/th_01')
  await expect(page).toHaveURL('/login?next=%2Fworkspaces%2Fws_01%2Fmessages%2Fthreads%2Fth_01')
  await capture(page, testInfo, 'thread-login.png')

  await logIn(page)
  await expect(page).toHaveURL('/workspaces/ws_01/messages/threads/th_01')
  await expect(page.getByRole('heading', { level: 2, name: '이재환' })).toBeVisible()
  await expect(page.getByRole('region', { name: '대화 내용' })).toBeVisible()
  await capture(page, testInfo, 'thread-after-login.png')
})

test('비로그인으로 연 태스크는 로그인 뒤 그 태스크로 돌아간다', async ({ page }, testInfo) => {
  await start(page, 'signed-out', '/workspaces/ws_01/tasks/tk_01')
  await expect(page).toHaveURL('/login?next=%2Fworkspaces%2Fws_01%2Ftasks%2Ftk_01')

  await logIn(page)
  await expect(page).toHaveURL('/workspaces/ws_01/tasks/tk_01')
  await expect(page.getByLabel('태스크 정보')).toBeVisible()
  await expect(page.getByRole('heading', { name: '로그인 API 연동' })).toBeVisible()
  await capture(page, testInfo, 'task-after-login.png')
})

for (const next of ['https%3A%2F%2Fevil.com', '%2F%2Fevil.com']) {
  test(`돌아갈 경로가 앱 밖(${next})이면 버리고 워크스페이스 선택으로 간다`, async ({
    page,
    baseURL,
  }, testInfo) => {
    await start(page, 'signed-out', `/login?next=${next}`)
    await logIn(page)

    await expect(page.getByRole('heading', { name: '워크스페이스 선택' })).toBeVisible()
    await expect(page).toHaveURL('/workspaces')
    expect(new URL(page.url()).origin).toBe(new URL(baseURL ?? '').origin)
    await capture(page, testInfo, 'external-next-ignored.png')
  })
}

test('직접 로그아웃하면 돌아갈 경로 없이 로그인으로 가고, 다시 로그인하면 워크스페이스 선택이다', async ({
  page,
}, testInfo) => {
  await start(page, 'multiple-workspaces', '/workspaces/ws_01/tasks/tk_01')
  await expect(page.getByLabel('태스크 정보')).toBeVisible()

  await page.getByRole('button', { name: /^내 계정/ }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible()
  await capture(page, testInfo, 'logout-login.png')

  await logIn(page)
  await expect(page.getByRole('heading', { name: '워크스페이스 선택' })).toBeVisible()
  await expect(page).toHaveURL('/workspaces')
})
