import type { MessageDto, MessageThreadDto } from '@/shared/types/api/message'
import { toMessageInbox, toMessageThread } from './mapper'

const bot: MessageDto = {
  message_id: 'mg_01',
  sender: 'bot',
  body: '진행 상황 알려 주세요 🙂',
  sent_at: '2026-09-10T18:00:00+09:00',
}
const reply: MessageDto = { ...bot, message_id: 'mg_02', sender: 'counterpart', body: '네' }
const thread = (kind: MessageThreadDto['kind'], messages: MessageDto[]): MessageThreadDto => ({
  thread_id: 'th_01',
  kind,
  name: '이재환',
  messages,
})

it('목록 DTO 를 도메인으로 옮기고 마지막 메시지로 답장 대기를 정한다', () => {
  expect(
    toMessageInbox({
      reviews: [
        {
          review_id: 'rv_01',
          recipient_name: '이재환',
          summary: '진행 상황 DM',
          body: '본문',
          created_at: '2026-09-17T18:00:00+09:00',
        },
      ],
      threads: [
        { thread_id: 'th_01', kind: 'direct', name: '이재환', last_message: bot },
        { thread_id: 'th_02', kind: 'direct', name: '박민수', last_message: reply },
        { thread_id: 'th_05', kind: 'channel', name: '#회의록 요약', last_message: bot },
        { thread_id: 'th_06', kind: 'direct', name: '정하늘', last_message: null },
      ],
    }),
  ).toEqual({
    reviews: [
      {
        id: 'rv_01',
        recipientName: '이재환',
        summary: '진행 상황 DM',
        body: '본문',
        createdAt: '2026-09-17T18:00:00+09:00',
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
          sentAt: '2026-09-10T18:00:00+09:00',
        },
        awaitingReply: true,
      },
      expect.objectContaining({ id: 'th_02', awaitingReply: false }),
      // 채널은 답장을 기다리지 않는다
      expect.objectContaining({ id: 'th_05', awaitingReply: false }),
      { id: 'th_06', kind: 'direct', name: '정하늘', lastMessage: null, awaitingReply: false },
    ],
  })
})

it.each([
  ['봇이 마지막으로 보낸 DM', thread('direct', [reply, bot]), true],
  ['상대가 답한 DM', thread('direct', [bot, reply]), false],
  ['봇이 보낸 채널', thread('channel', [bot]), false],
  ['메시지가 없는 DM', thread('direct', []), false],
])('대화: %s 의 답장 대기는 %s', (_name, dto, expected) => {
  const mapped = toMessageThread(dto)
  expect(mapped.awaitingReply).toBe(expected)
  expect(mapped.messages.map(({ id }) => id)).toEqual(dto.messages.map((m) => m.message_id))
})
