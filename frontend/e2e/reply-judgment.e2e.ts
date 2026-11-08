import { expect, test } from '@playwright/test'
import { start } from './support'

/*
 * #344 — 리마인드 답장 판단 결과. PM 이 AI 가 정하지 못한 답장의 태스크를 대화에서 고르고, 태스크 기록에서 답장과 그 답장이
 * 바꾼 값을 한 칸으로 보고 자동 반영을 되돌린다. 팀원에게는 답장 글이 보이지 않는다.
 * 오류(404·409·5xx)와 세션 경계는 app/messagesAttributionMsw.test.tsx·app/taskReplyTimeline.test.tsx 가 본다
 */

test('PM 은 어느 태스크인지 모르는 답장의 태스크를 고르고 새로고침 뒤에도 남는다', async ({
  page,
}) => {
  await start(page, 'reply-judgment', '/workspaces/ws_01/messages/threads/th_02')
  const conversation = page.getByRole('region', { name: '대화 내용' })
  await expect(conversation.getByText('어느 태스크에 대한 답장인가요?')).toBeVisible()
  await expect(conversation.getByRole('button', { name: '정하기' })).toBeDisabled()

  await conversation.getByRole('radio', { name: '회원가입 화면' }).check()
  await conversation.getByRole('button', { name: '정하기' }).click()

  await expect(
    page.getByText("'회원가입 화면'에 대한 답장으로 정했어요. AI가 다시 판단해요.", {
      exact: true,
    }),
  ).toBeVisible()
  await expect(conversation.getByText('태스크: 회원가입 화면')).toBeVisible()
  await expect(conversation.getByRole('radio')).toHaveCount(0)

  await page.reload()
  await expect(
    page.getByRole('region', { name: '대화 내용' }).getByText('태스크: 회원가입 화면'),
  ).toBeVisible({ timeout: 15_000 })
})

test('PM 은 태스크 기록에서 답장과 바뀐 값을 함께 보고 자동 반영을 되돌린다', async ({ page }) => {
  await start(page, 'reply-judgment', '/workspaces/ws_01/tasks/tk_03')
  const history = page.getByRole('list', { name: '변경 이력' })
  await expect(history.getByText('DB 스키마 정리는 끝냈어요.', { exact: false })).toBeVisible()
  const changes = history.getByRole('list', { name: '답장으로 바뀐 값' })
  await expect(changes.getByText('자동 반영')).toBeVisible()
  await expect(changes.getByText('승인 대기')).toBeVisible()
  await expect(history.getByText('상태: 막힘 → 완료')).toHaveCount(0)
  await expect(page.getByTestId('task-status')).toHaveText('완료')

  await changes.getByRole('button', { name: '되돌리기' }).click()

  await expect(page.getByText('답장으로 바꾼 값을 되돌렸어요', { exact: true })).toBeVisible()
  await expect(page.getByTestId('task-status')).toHaveText('막힘')
  await expect(changes.getByText('되돌림')).toBeVisible()
  await expect(changes.getByRole('button', { name: '되돌리기' })).toHaveCount(0)
})

test('팀원은 태스크 기록에서 답장 글 대신 안내를 보고 되돌리기가 없다', async ({ page }) => {
  await start(page, 'reply-judgment-member', '/workspaces/ws_01/tasks/tk_03')
  const history = page.getByRole('list', { name: '변경 이력' })
  await expect(history.getByText('답장 내용은 PM과 답장한 팀원만 볼 수 있어요.')).toBeVisible()
  await expect(history.getByText('DB 스키마 정리는 끝냈어요.', { exact: false })).toHaveCount(0)
  await expect(history.getByRole('button', { name: '되돌리기' })).toHaveCount(0)
})
