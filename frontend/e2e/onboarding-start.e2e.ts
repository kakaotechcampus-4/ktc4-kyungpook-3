import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, start } from './support'

test('일반 회원 가입 뒤 팀원 선택은 내 팀만 확인하고 reload·뒤로가기 후에도 생성하지 않는다', async ({
  page,
}, testInfo) => {
  const writes: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (
      (request.method() === 'POST' && path === '/api/v1/workspaces') ||
      (request.method() === 'PATCH' && /^\/api\/v1\/workspaces\/[^/]+\/onboarding$/.test(path))
    )
      writes.push(`${request.method()} ${path}`)
  })
  await page.setViewportSize({ width: 1024, height: 900 })
  await start(page, 'signed-out', '/signup')
  await page.getByLabel('이름').fill('일반 팀원')
  await page.getByLabel('이메일').fill('member-start@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('pass1234')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page).toHaveURL('/onboarding/start')
  await expect(page.getByRole('link', { name: /PM으로 팀 만들기/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await testInfo.attach('start-choices.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.reload()
  const member = page.getByRole('link', { name: /팀원으로 시작/ })
  await member.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/onboarding/member')
  await expect(page.getByText('아직 소속된 워크스페이스가 없어요.')).toBeVisible()
  await expect(page.getByRole('button', { name: '새 워크스페이스 만들기' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: '목록 다시 확인' }).click()
  await expect(page.getByRole('button', { name: '목록 다시 확인' })).toBeEnabled()
  await page.reload()
  await expect(page).toHaveURL('/onboarding/member')
  await expect(page.getByText('아직 소속된 워크스페이스가 없어요.')).toBeVisible()
  await testInfo.attach('member-empty.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await testInfo.attach('member-empty.aria.txt', {
    body: await page.locator('main').ariaSnapshot(),
    contentType: 'text/plain',
  })
  await page.goBack()
  await expect(page).toHaveURL('/onboarding/start')
  await expect(page.getByRole('heading', { name: '어떻게 시작할까요?' })).toBeVisible()
  await page.getByRole('link', { name: /팀원으로 시작/ }).click()
  await page.getByRole('link', { name: '시작 방식 다시 선택' }).click()
  await expect(page).toHaveURL('/onboarding/start')
  expect(writes).toEqual([])
})

test('소속이 없는 사용자는 PM 선택 후 기존 네 단계 흐름에서 팀을 만들 수 있다', async ({
  page,
}, testInfo) => {
  const creates: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/workspaces') {
      creates.push(request.postData() ?? '')
    }
  })
  await start(page, 'no-workspace', '/login')
  await expect(page).toHaveURL('/onboarding/start')
  const pm = page.getByRole('link', { name: /PM으로 팀 만들기/ })
  await pm.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL('/onboarding/create_workspace')
  await expect(page.getByRole('img', { name: '4단계 중 1단계' })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL('/onboarding/start')
  expect(creates).toEqual([])
  await page.getByRole('link', { name: /PM으로 팀 만들기/ }).click()
  await page.reload()
  await page.getByLabel('팀 이름').fill('PM 시작 팀')
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/workspaces',
  )
  await page.getByRole('button', { name: '만들기' }).click()
  const response = await created
  expect(response.status()).toBe(201)
  expect(await response.json()).toMatchObject({ data: { name: 'PM 시작 팀', role: 'pm' } })
  await expect(page).toHaveURL(/\/onboarding\/ws_\d+\/connect_discord$/)
  await expect(page.getByRole('img', { name: '4단계 중 2단계' })).toBeVisible()
  expect(creates).toHaveLength(1)
  await testInfo.attach('pm-created.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await testInfo.attach('pm-created.aria.txt', {
    body: await page.locator('main').ariaSnapshot(),
    contentType: 'text/plain',
  })
})
