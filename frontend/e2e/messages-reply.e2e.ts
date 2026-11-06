import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #367 — 팀원 행에도 연결된 PM 은 자기 대화(th_06, mb_01)에서 웹 답장을 쓰고, 남의 대화(th_01)에는 답장 칸이 없다.
 * #417 — 그 자기 대화는 목록 맨 위 `내 리마인드` 구역에 있고 팀원 화면 규칙(기다림 표시 없음)으로 그린다.
 * #371 — 일반 팀원(mb_01)도 메시지 화면에서 자기 대화에 웹 답장을 쓴다.
 * 워크스페이스 응답의 member_id 가 없거나 null 일 때 숨기는 것, 빈 답장·실패·남의 대화 주소는 app/messagesMsw.test.tsx 가 본다
 */

test('PM 은 자기 대화에서 웹 답장을 보내고 새로고침 뒤에도 남는다', async ({ page }) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_06')
  const reply = page.getByRole('form', { name: '답장' })
  await expect(reply).toBeVisible()

  await reply.getByLabel('답장').fill('PM 이 웹에서 남긴 답장이에요')
  await reply.getByRole('button', { name: '답장 보내기' }).click()

  const conversation = page.getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText('PM 이 웹에서 남긴 답장이에요')).toBeVisible()
  await expect(reply.getByLabel('답장')).toHaveValue('')

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

test('팀원은 메시지 화면에서 자기 대화에 웹 답장을 보내고 새로고침 뒤에도 남는다', async ({
  page,
}) => {
  await start(page, 'messages-member', '/workspaces/ws_01/messages')
  const reply = page.getByRole('form', { name: '답장' })
  await expect(reply).toBeVisible()

  await reply.getByLabel('답장').fill('팀원이 웹에서 남긴 답장이에요')
  await reply.getByRole('button', { name: '답장 보내기' }).click()

  const conversation = page.getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText('팀원이 웹에서 남긴 답장이에요')).toBeVisible()
  await expect(conversation.getByText('09:00 · 웹에서 답장')).toBeVisible()
  await expect(reply.getByLabel('답장')).toHaveValue('')

  await page.reload()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('팀원이 웹에서 남긴 답장이에요'),
  ).toBeVisible({ timeout: 15_000 })
})
