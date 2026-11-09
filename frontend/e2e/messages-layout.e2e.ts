import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { paths } from '@/shared/config/routes'
import {
  LONG_RECIPIENT_NAME,
  LONG_UNBROKEN_URL,
  LONG_WORKSPACE_NAME,
} from '@/shared/mock/fixtures/message'
import { start } from './support'

/*
 * M8 메시지 — 실제 브라우저에서만 잴 수 있는 배치·넘침과 hover 면 (#482).
 * 흐름(잠금·저장 중·승인 요청)은 src/app/messagesActionsMsw.test.tsx 가 본다.
 *
 * - messages-long-content: messages-default 에 긴 공간(봇) 이름, 이재환(bd_01·th_01)의 긴 이름·여러 줄 본문·줄바꿈할 곳이 없는 주소,
 *   박민수(th_02)의 며칠에 걸친 30통을 더한다
 * - messages-schedule-passed: bd_06 은 마감 기준 시각이 지나 `마감 하루 전` 을 고를 수 없다
 */

const FIRST_PAINT = { timeout: 15_000 }
const CONTROL_FACE = 'rgb(237, 237, 237)'

const detailOf = (page: Page) => page.getByRole('region', { name: '메시지 내용' })
const timingCard = (page: Page, name: RegExp) =>
  detailOf(page).getByRole('radio', { name }).locator('xpath=ancestor::label[1]')

/** 내용이 칸보다 넓거나 높은 만큼(px). 0 이하면 칸 안에 들어간다 */
const overflowOf = (locator: Locator) =>
  locator.evaluate((element) => ({
    x: element.scrollWidth - element.clientWidth,
    y: element.scrollHeight - element.clientHeight,
  }))

async function expectNoHorizontalOverflow(locator: Locator) {
  expect((await overflowOf(locator)).x).toBeLessThanOrEqual(0)
}

const faceOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).backgroundColor)

/** 포인터를 카드 밖 빈 곳으로 옮긴다 — 다음 hover 의 바탕을 잰다 */
async function pointerAway(page: Page) {
  await page.mouse.move(0, 0)
}

/** 마우스를 올려도 카드의 면이 그대로다 */
async function expectNoHoverFace(page: Page, card: Locator) {
  await pointerAway(page)
  const rest = await faceOf(card)
  await card.hover()
  await expect(card).toHaveCSS('background-color', rest)
  expect(rest).not.toBe(CONTROL_FACE)
}

test('긴 문구의 DM 미리보기는 카드가 본문만큼 늘고, 긴 주소·이름은 칸 안에서 줄을 바꿔 상세 칸이 가로로 넘치지 않는다', async ({
  page,
}) => {
  await start(page, 'messages-long-content', paths.messageReview('ws_01', 'bd_01'))
  const detail = detailOf(page)
  const card = detail.getByRole('region', { name: '보낼 메시지 미리보기' })
  const body = card.getByText(/12번째 줄이에요/)
  await expect(body).toBeVisible(FIRST_PAINT)
  await expect(card.getByText(LONG_WORKSPACE_NAME, { exact: true })).toBeVisible()
  await expect(detail.getByText(LONG_RECIPIENT_NAME, { exact: true })).toBeVisible()
  const cardOverflow = await overflowOf(card)
  expect(cardOverflow.x).toBeLessThanOrEqual(0)
  expect(cardOverflow.y).toBeLessThanOrEqual(0)
  await expectNoHorizontalOverflow(body)
  await expectNoHorizontalOverflow(card.locator('xpath=ancestor::article[1]/..'))
})

test('긴 문구의 대화는 말풍선·대화 칸·아래 안내·목록 칸 어디도 가로로 넘치지 않는다', async ({
  page,
}) => {
  await start(page, 'messages-long-content', paths.messageThread('ws_01', 'th_01'))
  const detail = detailOf(page)
  const conversation = detail.getByRole('region', { name: '대화 내용' })
  const bubbles = conversation.locator('p').filter({ hasText: LONG_UNBROKEN_URL })
  await expect(bubbles).toHaveCount(2, FIRST_PAINT)
  for (const bubble of await bubbles.all()) await expectNoHorizontalOverflow(bubble)
  await expectNoHorizontalOverflow(conversation)
  await expectNoHorizontalOverflow(detail.getByText(/^웹 계정이 연결되지 않아/))
  await expectNoHorizontalOverflow(page.getByRole('complementary', { name: '메시지 목록' }))
})

test('며칠에 걸친 긴 대화는 대화 칸만 세로로 스크롤하고, 처음부터 맨 아래의 최근 메시지가 보인다', async ({
  page,
}) => {
  await start(page, 'messages-long-content', paths.messageThread('ws_01', 'th_02'))
  const conversation = detailOf(page).getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText(/30번째 메시지예요/)).toBeVisible(FIRST_PAINT)
  await expect
    .poll(() =>
      conversation.evaluate((element) => ({
        scrolls: element.scrollHeight > element.clientHeight,
        atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      })),
    )
    .toEqual({ scrolls: true, atBottom: true })
  const pageScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )
  expect(pageScroll).toBe(0)
})

test('언제 보낼까요? 카드는 고를 수 있는 카드만 hover 면이 #EDEDED 이고, 고른 카드·고를 수 없는 카드는 그대로다', async ({
  page,
}) => {
  await start(page, 'messages-default', paths.messageReview('ws_01', 'bd_02'))
  await expect(
    detailOf(page).getByRole('radio', { name: /직접 정하기/, checked: true }),
  ).toBeAttached(FIRST_PAINT)
  const deadline = timingCard(page, /마감 하루 전/)
  await expect(deadline).toBeVisible()
  await pointerAway(page)
  expect(await faceOf(deadline)).not.toBe(CONTROL_FACE)
  await deadline.hover()
  await expect(deadline).toHaveCSS('background-color', CONTROL_FACE)
  await expectNoHoverFace(page, timingCard(page, /직접 정하기/))

  await start(page, 'messages-schedule-passed', paths.messageReview('ws_01', 'bd_06'))
  await expect(detailOf(page).getByRole('radio', { name: /마감 하루 전/ })).toBeDisabled(
    FIRST_PAINT,
  )
  await expectNoHoverFace(page, timingCard(page, /마감 하루 전/))
})

/** 이 묶음의 보낼 시각 저장(PATCH)을 보내지 않고 붙잡는다 — 앱의 API 클라이언트는 axios(XHR)다 */
function holdScheduleSave(page: Page, bundleId: string) {
  return page.addInitScript((path) => {
    class HeldRequest extends XMLHttpRequest {
      private held = false
      open(
        method: string,
        url: string | URL,
        async = true,
        username?: string | null,
        password?: string | null,
      ) {
        this.held =
          method.toUpperCase() === 'PATCH' && new URL(String(url), location.href).pathname === path
        super.open(method, url, async, username, password)
      }
      send(body?: Document | XMLHttpRequestBodyInit | null) {
        if (!this.held) super.send(body)
      }
    }
    window.XMLHttpRequest = HeldRequest
  }, `/api/v1/workspaces/ws_01/messages/bundles/${bundleId}`)
}

test('보낼 시각을 저장하는 동안 이대로 발송·보내지 않음은 잠겨도 면과 글자색이 그대로이고, 잠긴 카드는 hover 면이 없다', async ({
  page,
}) => {
  await holdScheduleSave(page, 'bd_02')
  await start(page, 'messages-default', paths.messageReview('ws_01', 'bd_02'))
  const detail = detailOf(page)
  const send = detail.getByRole('button', { name: '이대로 발송' })
  const dismiss = detail.getByRole('button', { name: '보내지 않음' })
  const deadline = timingCard(page, /마감 하루 전/)
  await expect(deadline).toBeVisible(FIRST_PAINT)
  await pointerAway(page)
  const before = {
    sendFace: await faceOf(send),
    sendText: await send.evaluate((element) => getComputedStyle(element).color),
    dismissText: await dismiss.evaluate((element) => getComputedStyle(element).color),
    deadlineFace: await faceOf(deadline),
  }

  await deadline.click()
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  await expect(dismiss).toHaveAttribute('aria-disabled', 'true')
  await expect(deadline.getByText('저장 중')).toBeVisible()
  await expect(send).toHaveCSS('background-color', before.sendFace)
  await expect(send).toHaveCSS('color', before.sendText)
  await expect(dismiss).toHaveCSS('color', before.dismissText)
  await deadline.hover()
  await expect(deadline).toHaveCSS('background-color', before.deadlineFace)
  expect(before.deadlineFace).not.toBe(CONTROL_FACE)
})
