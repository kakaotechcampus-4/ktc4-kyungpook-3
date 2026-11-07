import { expect, test } from '@playwright/test'
import { capture, start } from './support'

/*
 * #370 — PM 이 메시지 화면의 `새 재촉` 으로 재촉을 만들면 그 보낼 메시지의 보내기 전 확인으로 옮겨 가고,
 * 새로고침 뒤에도 목록에 남는다. 브라우저 MSW 는 시계를 목의 고정 시각(9/18 09:00)에 맞춘다.
 * 고르기·잠금 이유·실패 문구·태스크 상세 진입은 app/reminderCreateMsw.test.tsx 가 본다
 */

test('새 재촉으로 만든 재촉은 보내기 전 확인에 남고 새로고침 뒤에도 그대로다', async ({ page }) => {
  await start(page, 'messages-default', '/workspaces/ws_01/messages')
  await page.getByRole('link', { name: '새 재촉', exact: true }).click()
  await expect(page).toHaveURL(/\/messages\?new=reminder$/)
  await expect(page.getByRole('heading', { level: 2, name: '새 재촉' })).toBeVisible()

  await page.getByRole('combobox', { name: '받는 사람' }).click()
  await page.getByRole('option', { name: '이재환' }).click()
  await page.getByRole('combobox', { name: '태스크' }).click()
  await page.getByRole('option', { name: 'DB 스키마 정리' }).click()
  await expect(page.getByRole('radio', { name: /^마감 하루 전\s*09\/21 09:00$/ })).toBeChecked()
  await page.getByRole('button', { name: '재촉 만들기' }).click()

  await expect(page).toHaveURL(/\/messages\?review=bd_03$/)
  await expect(page.getByRole('heading', { level: 2, name: '이 메시지, 보낼까요?' })).toBeVisible()
  await expect(
    page.getByText('재촉을 만들었어요. 메시지 화면에서 확인하고 승인해야 나가요.', { exact: true }),
  ).toBeVisible()
  const reviews = page.getByRole('region', { name: /^보내기 전 확인/ })
  await expect(reviews.getByRole('link')).toHaveCount(3)

  await page.reload()
  await expect(page.getByRole('region', { name: /^보내기 전 확인/ }).getByRole('link')).toHaveCount(
    3,
    { timeout: 15_000 },
  )
  await expect(page.getByText('묶은 태스크 1')).toBeVisible()
})

test('보내기 전 확인에서 태스크를 빼고 남은 태스크의 메모를 고치면 새로고침 뒤에도 그대로다', async ({
  page,
}) => {
  await start(page, 'messages-default', '/workspaces/ws_01/messages?review=bd_02')
  await expect(page.getByText('묶은 태스크 2')).toBeVisible()

  await page.getByRole('button', { name: "'발표 자료' 빼기" }).click()
  const confirm = page.getByRole('group', { name: /^빼면 남은 태스크로 문구를 다시 만들어요/ })
  await confirm.getByRole('button', { name: '빼기', exact: true }).click()
  await expect(
    page.getByText("'발표 자료'을 뺐어요. 문구를 다시 만들었으니 확인하고 승인해 주세요.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByText('묶은 태스크 1')).toBeVisible()

  // 목은 문구를 다시 만들 때 태스크의 지금 제목을 읽어 남은 행의 제목이 바뀔 수 있다 — 행이 하나라 이름 끝으로 고른다
  await page.getByRole('button', { name: /메모 고치기$/ }).click()
  const field = page.getByRole('textbox', { name: /메모$/ })
  await field.fill('시안 3차까지')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('메모: 시안 3차까지')).toBeVisible()

  await page.reload()
  await expect(page.getByText('묶은 태스크 1')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('메모: 시안 3차까지')).toBeVisible()
})

test('태스크 상세에서 만든 재촉은 메시지 화면 링크로 그 보내기 전 확인을 연다', async ({
  page,
}) => {
  await start(page, 'messages-default', '/workspaces/ws_01/tasks/tk_01')
  const section = page.getByRole('region', { name: '김서연에게 진행 상황을 물어볼까요?' })
  await section.getByRole('button', { name: '재촉 만들기' }).click()
  await section
    .getByRole('group', { name: '재촉 만들기' })
    .getByRole('button', { name: '재촉 만들기' })
    .click()

  const status = section.getByRole('status')
  await expect(status).toContainText('재촉을 만들었어요', { timeout: 10_000 })
  await status.getByRole('link', { name: '메시지 화면에서 확인하기' }).click()
  await expect(page).toHaveURL(/\/messages\?review=bd_\d+$/)
  await expect(page.getByRole('heading', { level: 2, name: /보낼까요|보낼 예정인/ })).toBeVisible()
})

/*
 * #411 ② 팀원이 봇 리마인드가 있는 자기 대화(th_06)를 열면 알림 띠가 보인다. 브라우저 알림 허용은 `알림 켜기` 를 누를 때만 묻는다.
 * 허용 창을 그냥 닫은 것('default')으로 흉내 내 실제 구독은 만들지 않는다. 켜기·거절·실패·iPhone 은 app/browserPushPrompt.test.tsx 가 본다
 */
test('팀원이 리마인드 대화를 열면 알림 띠가 보이고, 알림 켜기를 누를 때만 허용을 묻고, 닫으면 새로고침 뒤에도 없다', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'permissionRequests', 0)
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' })
    Notification.requestPermission = () => {
      Reflect.set(
        window,
        'permissionRequests',
        Number(Reflect.get(window, 'permissionRequests')) + 1,
      )
      return Promise.resolve('default')
    }
  })
  const permissionRequests = () =>
    page.evaluate(() => Number(Reflect.get(window, 'permissionRequests')))
  const pushRequests: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/v1/push/')) pushRequests.push(pathname)
  })

  await start(page, 'messages-member-push', '/workspaces/ws_01/messages/threads/th_06')
  const band = page.getByRole('region', { name: '기기 알림' })
  await expect(
    band.getByRole('heading', { name: '다음 리마인드를 기기 알림으로 받을까요?' }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(band.getByText('새 리마인드가 오면 이 기기로 바로 알려 드려요.')).toBeVisible()
  await expect(band.getByRole('button', { name: '알림 켜기' })).toBeVisible()
  await expect(band.getByRole('button', { name: '닫기' })).toBeVisible()
  expect(await permissionRequests()).toBe(0)
  expect(pushRequests).toContain('/api/v1/push/vapid-public-key')
  const conversation = page.getByRole('region', { name: '대화 내용' })
  const latest = conversation.getByRole('listitem').last()
  await expect(latest.getByText('DM 못 보냄')).toBeInViewport({ ratio: 1 })
  await expect(latest.getByText('18:00')).toBeInViewport({ ratio: 1 })
  await capture(page, testInfo, 'push-band.png')

  const first = conversation.getByText('서연님, 이번 주 할 일을 정리해 뒀어요.')
  await conversation.hover()
  await page.mouse.wheel(0, -5_000)
  await expect(first).toBeInViewport({ ratio: 1 })
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('viewport size is fixed in playwright.config')
  await page.setViewportSize({ ...viewport, height: viewport.height - 120 })
  await expect(first).toBeInViewport({ ratio: 1 })
  await page.setViewportSize(viewport)

  await band.getByRole('button', { name: '알림 켜기' }).click()
  await expect.poll(permissionRequests).toBe(1)
  await expect(band.getByRole('button', { name: '알림 켜기' })).toBeEnabled()

  await band.getByRole('button', { name: '닫기' }).click()
  await expect(band).toHaveCount(0)

  pushRequests.length = 0
  await page.reload()
  await expect(page.getByRole('region', { name: '대화 내용' })).toBeVisible({ timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  await expect(band).toHaveCount(0)
  expect(pushRequests).toEqual([])
  await capture(page, testInfo, 'push-band-closed.png')
})
