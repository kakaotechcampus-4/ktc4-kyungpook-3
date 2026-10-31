import type { MessageDto, MessageReviewDto } from '@/shared/types/api/message'
import { toMessageInbox, toMessageThread } from './mapper'

const bot: MessageDto = {
  message_id: 'mg_01',
  sender: 'bot',
  body: '진행 상황 알려 주세요 🙂',
  sent_at: '2026-09-16T18:00:00+09:00',
  status: 'sent',
  delivery: 'approved',
  approved_by: '최진호',
}
const review: MessageReviewDto = {
  review_id: 'rv_01',
  thread_id: 'th_01',
  recipient_name: '이재환',
  summary: '진행 상황 DM',
  body: '본문',
  created_at: '2026-09-17T18:00:00+09:00',
  deadline: '2026-09-24',
  reason: '마감이 다가와요.',
  reason_url: null,
  send_timing: 'day_before_deadline',
  scheduled_at: '2026-09-23T09:00:00+09:00',
  deadline_send_at: '2026-09-23T09:00:00+09:00',
}

it('목록 DTO 를 도메인으로 옮긴다 — 답장 대기는 서버가 준 시작 시각 그대로다', () => {
  expect(
    toMessageInbox({
      reviews: [review],
      threads: [
        {
          thread_id: 'th_01',
          kind: 'direct',
          name: '이재환',
          last_message: bot,
          awaiting_reply_since: bot.sent_at,
        },
        {
          thread_id: 'th_06',
          kind: 'direct',
          name: '정하늘',
          last_message: null,
          awaiting_reply_since: null,
        },
      ],
    }),
  ).toEqual({
    reviews: [
      {
        id: 'rv_01',
        threadId: 'th_01',
        recipientName: '이재환',
        summary: '진행 상황 DM',
        body: '본문',
        createdAt: '2026-09-17T18:00:00+09:00',
        deadline: '2026-09-24',
        reason: '마감이 다가와요.',
        reasonUrl: null,
        sendTiming: 'day_before_deadline',
        scheduledAt: '2026-09-23T09:00:00+09:00',
        deadlineSendAt: '2026-09-23T09:00:00+09:00',
      },
    ],
    threads: [
      {
        id: 'th_01',
        kind: 'direct',
        name: '이재환',
        lastMessage: {
          id: 'mg_01',
          sender: 'bot',
          body: '진행 상황 알려 주세요 🙂',
          sentAt: '2026-09-16T18:00:00+09:00',
          status: 'sent',
          delivery: 'approved',
          approvedBy: '최진호',
        },
        awaitingReplySince: '2026-09-16T18:00:00+09:00',
      },
      { id: 'th_06', kind: 'direct', name: '정하늘', lastMessage: null, awaitingReplySince: null },
    ],
  })
})

it('대화 DTO 를 도메인으로 옮긴다 — 역할·Discord 주소·승인 대기 항목을 함께 싣는다', () => {
  expect(
    toMessageThread({
      thread_id: 'th_01',
      kind: 'direct',
      name: '이재환',
      team_role: '백엔드',
      discord_url: 'https://discord.com/channels/@me/mock-th_01',
      messages: [bot, { ...bot, message_id: 'mg_02', status: 'scheduled' }],
      awaiting_reply_since: bot.sent_at,
      pending_reviews: [{ review_id: 'rv_01', body: '본문', scheduled_at: null }],
    }),
  ).toMatchObject({
    id: 'th_01',
    teamRole: '백엔드',
    discordUrl: 'https://discord.com/channels/@me/mock-th_01',
    messages: [
      { id: 'mg_01', status: 'sent' },
      { id: 'mg_02', status: 'scheduled' },
    ],
    awaitingReplySince: '2026-09-16T18:00:00+09:00',
    pendingReviews: [{ id: 'rv_01', body: '본문', scheduledAt: null }],
  })
})
