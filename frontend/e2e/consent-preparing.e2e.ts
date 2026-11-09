import { expect, test } from '@playwright/test'
import { signUp, start } from './support'

test('미공개 상태는 동의 API를 부르지 않고 기존 가입과 업무 진입을 유지한다', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/v1\/consents(?:\/me)?$/.test(request.url())) requests.push(request.url())
  })
  await start(page, 'single-workspace', '/workspaces/ws_01/settings')
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '서비스 이용 동의' })).toHaveCount(0)
  await start(page, 'signed-out', '/signup')
  await signUp(page, { name: '준비 사용자', email: 'preparing@example.com', password: 'pass1234' })
  await expect(page).toHaveURL('/onboarding/start')
  expect(requests).toEqual([])
  await page.goto('/terms')
  await expect(page.getByText('문서를 준비하고 있어요.')).toBeVisible()
})
