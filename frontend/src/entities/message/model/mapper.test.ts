import type { BundleDto, MessageDto, ThreadSummaryDto } from '@/shared/types/api/message'
import { toBundle, toMessage, toMessageInbox, toMessageThread } from './mapper'

const botDto = (patch: Partial<MessageDto> = {}): MessageDto => ({
  message_id: 'mg_01',
  thread_id: 'th_01',
  sender: 'bot',
  body: '진행 상황 알려 주세요 🙂',
  created_at: '2026-09-16T09:00:00Z',
  reply_channel: null,
  dm_status: 'delivered',
  dm_failure_reason: null,
  scheduled_at: '2026-09-16T09:00:00Z',
  ...patch,
})

const memberDto = (patch: Partial<MessageDto> = {}): MessageDto => ({
  ...botDto(),
  message_id: 'mg_02',
  sender: 'member',
  body: '네',
  reply_channel: 'web',
  dm_status: null,
  scheduled_at: null,
  ...patch,
})

const bundleDto = (patch: Partial<BundleDto> = {}): BundleDto => ({
  bundle_id: 'bd_01',
  thread_id: 'th_01',
  member_id: 'mb_03',
  recipient_name: '이재환',
  scheduled_at: '2026-09-23T00:00:00Z',
  status: 'scheduled',
  approved: false,
  approved_at: null,
  body: '재환님,\n진행 상황 알려 주세요',
  body_source: 'ai',
  draft_status: 'done',
  draft_version: 2,
  reminders: [
    {
      reminder_id: 'rm_01',
      bundle_id: 'bd_01',
      task_id: 'tk_01',
      task_title: 'API 명세서',
      due_date: '2026-09-24',
      note: null,
      status: 'scheduled',
      kind: 'nudge',
      origin: 'scheduler',
      created_at: '2026-09-15T00:00:00Z',
    },
  ],
  ...patch,
})

const summaryDto: ThreadSummaryDto = {
  thread_id: 'th_01',
  member_id: 'mb_03',
  name: '이재환',
  last_message: {
    message_id: 'mg_01',
    sender: 'bot',
    body: '진행 상황 알려 주세요 🙂',
    created_at: '2026-09-16T09:00:00Z',
  },
  awaiting_reply_since: '2026-09-16T09:00:00Z',
  dm_failed: true,
}

it('목록은 bundles 로 보는 사람을 가른다 — PM 은 묶음과 대화, 팀원은 대화만이다', () => {
  const pm = toMessageInbox({ threads: [summaryDto], bundles: [bundleDto()] })
  expect(pm.viewer).toBe('pm')
  expect(pm.threads).toEqual([
    {
      id: 'th_01',
      memberId: 'mb_03',
      name: '이재환',
      lastMessage: {
        id: 'mg_01',
        sender: 'bot',
        body: '진행 상황 알려 주세요 🙂',
        createdAt: '2026-09-16T09:00:00Z',
      },
      awaitingReplySince: '2026-09-16T09:00:00Z',
      dmFailed: true,
    },
  ])
  expect(pm.viewer === 'pm' && pm.bundles.map(({ id }) => id)).toEqual(['bd_01'])

  const member = toMessageInbox({ threads: [summaryDto], bundles: null })
  expect(member).toEqual({ viewer: 'member', threads: pm.threads })
})

it('묶음의 단계는 status·approved 에서, 초안 대기는 draft_status 에서 한 번만 정한다', () => {
  expect(toBundle(bundleDto())).toEqual({
    stage: 'awaitingApproval',
    id: 'bd_01',
    threadId: 'th_01',
    memberId: 'mb_03',
    recipientName: '이재환',
    scheduledAt: '2026-09-23T00:00:00Z',
    body: '재환님,\n진행 상황 알려 주세요',
    bodySource: 'ai',
    drafting: false,
    draftVersion: 2,
    tasks: [
      {
        reminderId: 'rm_01',
        taskId: 'tk_01',
        title: 'API 명세서',
        dueDate: '2026-09-24',
        note: null,
      },
    ],
  })
  expect(
    toBundle(bundleDto({ approved: true, approved_at: '2026-09-18T00:00:00Z' })),
  ).toMatchObject({ stage: 'approved', approvedAt: '2026-09-18T00:00:00Z' })
  expect(toBundle(bundleDto({ draft_status: 'needed' }))?.drafting).toBe(true)
  expect(toBundle(bundleDto({ draft_status: 'claimed' }))?.drafting).toBe(true)
  // 예정이 아닌 묶음은 그리지 않는다
  expect(toBundle(bundleDto({ status: 'cancelled' }))).toBeNull()
  expect(toMessageInbox({ threads: [], bundles: [bundleDto({ status: 'sent' })] })).toEqual({
    viewer: 'pm',
    bundles: [],
    threads: [],
  })
})

it('승인한 묶음에 승인 시각이 없으면 던진다', () => {
  expect(() => toBundle(bundleDto({ approved: true }))).toThrow(/승인 시각/)
})

it('대화 메시지는 보낸 쪽으로 갈린다 — 봇은 DM 상태, 팀원은 답장 경로를 갖는다', () => {
  expect(toMessage(botDto())).toEqual({
    sender: 'bot',
    id: 'mg_01',
    body: '진행 상황 알려 주세요 🙂',
    createdAt: '2026-09-16T09:00:00Z',
    dm: { status: 'delivered' },
  })
  expect(toMessage(botDto({ dm_status: 'failed', dm_failure_reason: 'dm_blocked' }))).toMatchObject(
    { dm: { status: 'failed', reason: 'dm_blocked' } },
  )
  // 이유 없이 실패로 오면 모르는 이유다
  expect(toMessage(botDto({ dm_status: 'failed' }))).toMatchObject({
    dm: { status: 'failed', reason: 'unknown' },
  })
  expect(toMessage(memberDto())).toEqual({
    sender: 'member',
    id: 'mg_02',
    body: '네',
    createdAt: '2026-09-16T09:00:00Z',
    replyChannel: 'web',
  })
})

it('보낸 쪽과 칸이 맞지 않으면 던진다', () => {
  expect(() => toMessage(botDto({ dm_status: null }))).toThrow(/mg_01/)
  expect(() => toMessage(memberDto({ reply_channel: null }))).toThrow(/mg_02/)
})

it('대화는 요약·메시지·예정 묶음이다 — 팀원의 bundles null 은 빈 예정이다', () => {
  const pm = toMessageThread({
    thread: summaryDto,
    messages: [botDto(), memberDto()],
    bundles: [bundleDto()],
  })
  expect(pm.messages.map(({ sender }) => sender)).toEqual(['bot', 'member'])
  expect(pm.upcoming.map(({ id }) => id)).toEqual(['bd_01'])
  expect(pm).toMatchObject({ id: 'th_01', name: '이재환', dmFailed: true })

  const member = toMessageThread({ thread: summaryDto, messages: [], bundles: null })
  expect(member.upcoming).toEqual([])
})
