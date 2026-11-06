import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #367 — 팀원 행에도 연결된 PM 은 자기 대화(th_06, mb_01)에서 웹 답장을 쓰고, 남의 대화(th_01)에는 답장 칸이 없다.
 * 워크스페이스 응답의 member_id 가 없거나 null 일 때 숨기는 것은 app/messagesMsw.test.tsx 가 본다
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

test('PM 이 남의 대화를 열면 답장 칸 대신 안내 바가 보인다', async ({ page }) => {
  await start(page, 'messages-pm-self', '/workspaces/ws_01/messages/threads/th_01')
  await expect(page.getByRole('region', { name: '대화 내용' })).toBeVisible()
  await expect(page.getByText(/^메시지는 항상/)).toBeVisible()
  await expect(page.getByRole('form', { name: '답장' })).toHaveCount(0)
})
