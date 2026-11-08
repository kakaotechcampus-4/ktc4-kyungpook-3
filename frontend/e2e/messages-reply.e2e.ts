import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { start } from './support'

/*
 * #367 — 팀원 행에도 연결된 PM 은 자기 대화(th_06, mb_01)에서 웹 답장을 쓰고, 남의 대화(th_01)에는 답장 칸이 없다.
 * #417 — 그 자기 대화는 목록 맨 위 `내 리마인드` 구역에 있고 팀원 화면 규칙(기다림 표시 없음)으로 그린다.
 * #371 — 일반 팀원(mb_01)도 메시지 화면에서 자기 대화에 웹 답장을 쓴다.
 * #474 — 답장 칸은 보내기 버튼과 한 줄이다. 한 줄 44px 에서 92px 까지 자라고 그 뒤로는 칸 안에서 스크롤한다.
 * 워크스페이스 응답의 member_id 가 없거나 null 일 때 숨기는 것, 빈 답장·Enter·조합 중 Enter·글자 수·실패·남의 대화 주소는
 * app/messagesMsw.test.tsx 가 본다
 */

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('보이지 않는 요소의 크기를 잴 수 없다')
  return found
}

test('PM 은 자기 대화에서 웹 답장을 보내고 새로고침 뒤에도 남는다', async ({ page }) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_06')
  const reply = page.getByRole('form', { name: '답장' })
  await expect(reply).toBeVisible()
  const field = reply.getByRole('textbox', { name: '답장' })
  const send = reply.getByRole('button', { name: '답장 보내기' })
  await expect(send).toBeDisabled()

  await field.fill('PM 이 웹에서 남긴 답장이에요')
  await send.click()

  const conversation = page.getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText('PM 이 웹에서 남긴 답장이에요')).toBeVisible()
  await expect(field).toHaveValue('')

  await page.reload()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('PM 이 웹에서 남긴 답장이에요'),
  ).toBeVisible({ timeout: 15_000 })
})

test('PM 의 자기 대화는 목록 맨 위 내 리마인드 구역에 있고, 고르면 팀원 화면 규칙으로 그린다 (#417)', async ({
  page,
}) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages')
  const list = page.getByRole('complementary', { name: '메시지 목록' })
  await expect(list.getByRole('heading', { level: 2 })).toHaveText([
    '내 리마인드',
    /^보내기 전 확인/,
    '대화',
  ])
  const self = list.getByRole('region', { name: '내 리마인드' })
  await expect(self.getByRole('link')).toHaveCount(1)
  await expect(list.getByRole('region', { name: '대화' }).getByText('김서연')).toHaveCount(0)

  await self.getByRole('link').click()
  await expect(page).toHaveURL(/\/messages\/threads\/th_06$/)
  await expect(self.getByRole('link')).toHaveAttribute('aria-current', 'page')
  const detail = page.getByRole('region', { name: '메시지 내용' })
  await expect(detail.getByRole('heading', { level: 2, name: /봇$/ })).toBeVisible()
  await expect(detail.getByText(/^답장 \d+일째 없음$/)).toHaveCount(0)
  await expect(detail.getByText(/여기서부터 답장이 없습니다/)).toHaveCount(0)
  await expect(detail.getByRole('form', { name: '답장' })).toBeVisible()
  await expect(detail.getByRole('link', { name: '확인하기' })).toBeVisible()
})

test('PM 이 남의 대화를 열면 답장 칸 대신 안내 바가 보인다', async ({ page }) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_01')
  await expect(page.getByRole('region', { name: '대화 내용' })).toBeVisible()
  await expect(page.getByText(/^메시지는 항상/)).toBeVisible()
  await expect(page.getByRole('form', { name: '답장' })).toHaveCount(0)
})

test('팀원은 메시지 화면에서 자기 대화에 Enter 로 웹 답장을 보내고 새로고침 뒤에도 남는다', async ({
  page,
}) => {
  await start(page, 'messages-member', '/workspaces/ws_01/messages')
  const reply = page.getByRole('form', { name: '답장' })
  await expect(reply).toBeVisible()
  const field = reply.getByRole('textbox', { name: '답장' })
  await expect(reply.getByRole('button', { name: '답장 보내기' })).toBeDisabled()

  await field.fill('팀원이 웹에서 남긴 답장이에요')
  await field.press('Enter')

  const conversation = page.getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText('팀원이 웹에서 남긴 답장이에요')).toBeVisible()
  await expect(conversation.getByText('09:00 · 웹에서 답장')).toBeVisible()
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()

  await page.reload()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('팀원이 웹에서 남긴 답장이에요'),
  ).toBeVisible({ timeout: 15_000 })
})

test('답장 칸은 한 줄 44px 에서 92px 까지 자라고 그 뒤로는 칸 안에서 스크롤하며, 보내기 버튼은 44×44 로 칸 위에 맞춘다', async ({
  page,
}) => {
  await start(page, 'messages-member', '/workspaces/ws_01/messages')
  const reply = page.getByRole('form', { name: '답장' })
  const field = reply.getByRole('textbox', { name: '답장' })
  const send = reply.getByRole('button', { name: '답장 보내기' })
  await expect(field).toBeVisible()

  await field.fill('한 줄')
  expect((await box(field)).height).toBe(44)
  await expect(field).toHaveCSS('overflow-y', 'hidden')

  await field.press('End')
  for (const line of ['둘', '셋', '넷', '다섯']) {
    await field.press('Shift+Enter')
    await field.pressSequentially(line)
  }
  await expect(field).toHaveValue('한 줄\n둘\n셋\n넷\n다섯')
  const grown = await box(field)
  expect(grown.height).toBe(92)
  await expect(field).toHaveCSS('overflow-y', 'auto')

  const button = await box(send)
  expect(button.width).toBe(44)
  expect(button.height).toBe(44)
  expect(button.y).toBe(grown.y)

  await field.press('Enter')
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText(/한 줄\s+둘\s+셋\s+넷\s+다섯/),
  ).toBeVisible()
  await expect(field).toHaveValue('')
  expect((await box(field)).height).toBe(44)
})
