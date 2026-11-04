import type { MessageDto, MessageReviewDto, MessageThreadDto } from '@/shared/types/api/message'
import { toMessage, toMessageInbox, toMessageReview, toMessageThread } from './mapper'

const sent = (patch: Partial<MessageDto> = {}): MessageDto => ({
  message_id: 'mg_01',
  sender: 'bot',
  body: '진행 상황 알려 주세요 🙂',
  status: 'sent',
  at: '2026-09-16T18:00:00+09:00',
  approved_by: '최진호',
  review_id: null,
  cancel_reason: null,
  source: null,
  attribution: null,
  schedule_passed: false,
  ...patch,
})

const review = (patch: Partial<MessageReviewDto> = {}): MessageReviewDto => ({
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
  status: 'pending',
  approved_by: null,
  deadline_send_passed: false,
  ...patch,
})

const thread = (messages: MessageDto[]): MessageThreadDto => ({
  thread_id: 'th_01',
  kind: 'direct',
  name: '이재환',
  team_role: '백엔드',
  discord_url: 'https://discord.com/channels/@me/mock-th_01',
  messages,
  awaiting_reply_since: '2026-09-16T18:00:00+09:00',
})

it('목록 DTO 를 상태별 도메인으로 옮긴다', () => {
  expect(
    toMessageInbox({
      reviews: [
        review(),
        review({ review_id: 'rv_02', status: 'scheduled', approved_by: '최진호' }),
      ],
      threads: [
        {
          thread_id: 'th_01',
          kind: 'direct',
          name: '이재환',
          last_message: sent(),
          awaiting_reply_since: '2026-09-16T18:00:00+09:00',
          needs_attribution: false,
        },
        {
          thread_id: 'th_06',
          kind: 'direct',
          name: '정하늘',
          last_message: null,
          awaiting_reply_since: null,
          needs_attribution: true,
        },
      ],
    }),
  ).toMatchObject({
    reviews: [
      { id: 'rv_01', state: { status: 'pending' }, deadlineSend: { status: 'open' } },
      { id: 'rv_02', state: { status: 'scheduled', approvedBy: '최진호' } },
    ],
    threads: [
      {
        id: 'th_01',
        needsAttribution: false,
        lastMessage: { sender: 'bot', status: 'sent', approvedBy: '최진호' },
      },
      { id: 'th_06', lastMessage: null, needsAttribution: true },
    ],
  })
})

it('대화의 재촉·답장을 상태별 메시지로 옮긴다', () => {
  expect(
    toMessageThread(
      thread([
        sent(),
        sent({
          message_id: 'mg_02',
          sender: 'member',
          approved_by: null,
          source: 'web',
          attribution: { status: 'resolved', task: null },
        }),
        sent({
          message_id: 'rv_01',
          status: 'pending',
          at: null,
          approved_by: null,
          review_id: 'rv_01',
        }),
        sent({
          message_id: 'rv_03',
          status: 'cancelled',
          at: '2026-09-08T09:00:00+09:00',
          approved_by: null,
          cancel_reason: 'responded',
        }),
        sent({
          message_id: 'rv_04',
          status: 'expired',
          at: '2026-09-09T18:00:00+09:00',
          approved_by: null,
        }),
      ]),
    ).messages,
  ).toEqual([
    {
      sender: 'bot',
      status: 'sent',
      id: 'mg_01',
      body: '진행 상황 알려 주세요 🙂',
      sentAt: '2026-09-16T18:00:00+09:00',
      approvedBy: '최진호',
    },
    {
      sender: 'member',
      id: 'mg_02',
      body: '진행 상황 알려 주세요 🙂',
      sentAt: '2026-09-16T18:00:00+09:00',
      source: 'web',
      attribution: { status: 'resolved', task: null },
    },
    {
      sender: 'bot',
      status: 'pending',
      id: 'rv_01',
      body: '진행 상황 알려 주세요 🙂',
      reviewId: 'rv_01',
      scheduledAt: null,
      schedulePassed: false,
    },
    {
      sender: 'bot',
      status: 'cancelled',
      id: 'rv_03',
      body: '진행 상황 알려 주세요 🙂',
      at: '2026-09-08T09:00:00+09:00',
      reason: 'responded',
    },
    {
      sender: 'bot',
      status: 'expired',
      id: 'rv_04',
      body: '진행 상황 알려 주세요 🙂',
      at: '2026-09-09T18:00:00+09:00',
    },
  ])
})

it('마감 하루 전은 없음·열림·지남으로 나눈다', () => {
  expect(toMessageReview(review({ deadline_send_at: null })).deadlineSend).toEqual({
    status: 'none',
  })
  expect(toMessageReview(review()).deadlineSend).toEqual({
    status: 'open',
    at: '2026-09-23T09:00:00+09:00',
  })
  expect(toMessageReview(review({ deadline_send_passed: true })).deadlineSend).toEqual({
    status: 'passed',
    at: '2026-09-23T09:00:00+09:00',
  })
})

it('상태와 칸이 맞지 않으면 던진다', () => {
  expect(() => toMessage(sent({ status: 'scheduled', review_id: null }))).toThrow(/rv_|mg_01|상태/)
  expect(() => toMessage(sent({ status: 'cancelled', cancel_reason: null }))).toThrow(/상태/)
  expect(() => toMessage(sent({ sender: 'member', source: null }))).toThrow(/상태/)
  expect(() =>
    toMessageInbox({
      reviews: [],
      threads: [
        {
          thread_id: 'th_01',
          kind: 'direct',
          name: '이재환',
          last_message: sent({
            status: 'pending',
            at: null,
            review_id: 'rv_01',
            approved_by: null,
          }),
          awaiting_reply_since: null,
          needs_attribution: false,
        },
      ],
    }),
  ).toThrow(/마지막 메시지/)
  expect(() => toMessageReview(review({ status: 'scheduled', approved_by: null }))).toThrow(
    /승인자/,
  )
  expect(() =>
    toMessageReview(review({ deadline_send_at: null, deadline_send_passed: true })),
  ).toThrow(/마감이 없는/)
})
