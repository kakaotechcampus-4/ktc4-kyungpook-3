import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { capture, expectNoHorizontalOverflow, start } from './support'

const WORKSPACE = '/workspaces/ws_01'
const pendingPill = (page: Page) => page.getByRole('group', { name: '주간 회고 녹음 정리 알림' })

async function openMeetingFromList(page: Page) {
  await page.getByRole('link', { name: '회의록', exact: true }).click()
  await page
    .getByRole('complementary', { name: '회의 목록' })
    .getByRole('list', { name: '진행 중' })
    .getByRole('link', { name: /주간 회고 녹음/ })
    .click()
}

async function assignSpeakers(page: Page) {
  await expect(page.getByRole('heading', { name: '누가 말했는지 골라 주세요' })).toBeVisible()
  for (const speaker of ['화자 1 지정', '화자 2 지정', '화자 3 지정']) {
    await page
      .getByRole('group', { name: speaker })
      .getByRole('radio', { name: /김서연/ })
      .click()
  }
  await page.getByRole('button', { name: /지정하고 정리 이어 가기/ }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11/processing`)
}

test('PM은 화자 지정 대기 알림을 닫고 화면을 옮겨도 새로고침 전까지 숨긴다', async ({
  page,
}, testInfo) => {
  await start(page, 'meeting-speakers', '/workspaces/ws_01/tasks')
  const card = page.getByRole('region', { name: '화자 지정이 필요해요' })
  await expect(card).toBeVisible()
  await capture(page, testInfo, 'waiting-before-dismiss.png')
  await card.getByRole('button', { name: '닫기', exact: true }).click({ timeout: 5_000 })
  await expect(card).toHaveCount(0)
  await page.getByRole('banner').getByRole('link', { name: '팀', exact: true }).click()
  await expect(page).toHaveURL('/workspaces/ws_01/members')
  await expect(card).toHaveCount(0)
  await capture(page, testInfo, 'hidden-after-navigation.png')
  await page.reload()
  await expect(card).toBeVisible()
  await capture(page, testInfo, 'rediscovered-after-refresh.png')
})

test('PM은 닫은 뒤에도 목록에서 화자를 지정하고 다른 화면에서 완료 결과를 받는다', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await start(page, 'meeting-speakers', `${WORKSPACE}/tasks`)
  const card = page.getByRole('region', { name: '화자 지정이 필요해요' })
  await card.getByRole('button', { name: '닫기' }).click()
  await openMeetingFromList(page)
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11/speakers`)
  await assignSpeakers(page)
  await page.getByRole('link', { name: '태스크', exact: true }).click()
  await expect(pendingPill(page)).toHaveCount(0)
  await expect(page.getByRole('region', { name: /주간 회고 녹음 정리 중/ })).toHaveCount(0)
  const done = page.getByRole('region', { name: '회의 정리가 끝났어요' })
  await expect(done).toBeVisible({ timeout: 35_000 })
  await capture(page, testInfo, 'completion-after-dismiss.png')
  await done.getByRole('button', { name: '회의록 보기' }).click()
  await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11`)
  await expect(done).toHaveCount(0)
})

for (const width of [1280, 360]) {
  test.describe(`팀원 ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('대기 알약은 키보드로 접기·펼치기·닫기가 되고 이동 후에도 숨지만 새로고침하면 다시 보인다', async ({
      page,
    }, testInfo) => {
      await start(page, 'meeting-speakers-member', `${WORKSPACE}/tasks`)
      const pill = pendingPill(page)
      const expand = pill.getByRole('button', { name: /펼치기/ })
      await expect(expand).toBeVisible()
      await expect(page.locator('button button')).toHaveCount(0)
      await expand.focus()
      await page.keyboard.press('Enter')
      const card = page.getByRole('region', { name: '주간 회고 녹음 정리 중' })
      await expect(card).toContainText('화자 지정을 기다리고 있어요')
      const collapse = card.getByRole('button', { name: '접기' })
      await expect(collapse).toBeFocused()
      await expectNoHorizontalOverflow(page)
      await page.keyboard.press('Enter')
      await expect(expand).toBeFocused()
      await page.keyboard.press('Tab')
      const close = pill.getByRole('button', { name: '닫기' })
      await expect(close).toBeFocused()
      const focus = await close.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          color: style.color,
        }
      })
      expect(focus.outlineWidth).toBe('2px')
      expect(focus.outlineColor).toBe(focus.color)
      const background = await pill.evaluate((element) => getComputedStyle(element).backgroundColor)
      expect(focus.color).not.toBe(background)
      await expectNoHorizontalOverflow(page)
      await capture(page, testInfo, 'keyboard-close-focused.png')
      await page.keyboard.press('Enter')
      await expect(pill).toHaveCount(0)
      await expect(card).toHaveCount(0)
      await page.getByRole('link', { name: '팀', exact: true }).click()
      await expect(page).toHaveURL(`${WORKSPACE}/members`)
      await expect(pill).toHaveCount(0)
      await openMeetingFromList(page)
      await expect(page).toHaveURL(`${WORKSPACE}/meetings/mt_11/speakers`)
      await expect(page.getByRole('heading', { name: 'PM이 화자를 지정하고 있어요' })).toBeVisible()
      await page.getByRole('link', { name: '태스크', exact: true }).click()
      await expect(pill).toHaveCount(0)
      await capture(page, testInfo, 'hidden-after-direct-route.png')
      await page.reload()
      await expect(pill).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await capture(page, testInfo, 'member-rediscovered-after-refresh.png')
    })
  })
}
