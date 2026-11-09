import type {
  BundleDto,
  MessageDto,
  ReminderDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import {
  toBundle,
  toCreatedReminder,
  toMessage,
  toMessageInbox,
  toMessageThread,
  toReplyAttribution,
} from './mapper'

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
  author_member_id: null,
  author_name: null,
  ...patch,
})

const pmDto = (patch: Partial<MessageDto> = {}): MessageDto => ({
  ...botDto(),
  message_id: 'mg_03',
  sender: 'pm',
  body: '오늘 회의 전에 한 번 봐 주세요',
  dm_status: 'pending',
  scheduled_at: null,
  author_member_id: 'mb_01',
  author_name: '김서연',
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

const reminderDto = (patch: Partial<ReminderDto> = {}): ReminderDto => ({
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
  summary: 'API 명세서 진행 상황 확인',
  reminders: [
    reminderDto({
      reason: "'API 명세서' 마감이 9/24(목)인데, 9/16(수) 이후로 진행 소식이 없어요.",
      evidence: { kind: 'reply', at: '2026-09-16T06:00:00Z', message_id: 'mg_02' },
    }),
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
    author_member_id: null,
    author_name: null,
  },
  awaiting_reply_since: '2026-09-16T09:00:00Z',
  dm_failed: true,
  web_reply_available: true,
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
        authorMemberId: null,
        authorName: null,
      },
      awaitingReplySince: '2026-09-16T09:00:00Z',
      dmFailed: true,
      webReply: 'available',
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
    summary: 'API 명세서 진행 상황 확인',
    tasks: [
      {
        reminderId: 'rm_01',
        taskId: 'tk_01',
        title: 'API 명세서',
        dueDate: '2026-09-24',
        note: null,
        reason: "'API 명세서' 마감이 9/24(목)인데, 9/16(수) 이후로 진행 소식이 없어요.",
        evidence: { kind: 'reply', at: '2026-09-16T06:00:00Z', messageId: 'mg_02' },
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

it('재촉 이유의 근거는 답장이면 메시지 ID 를, 태스크 변경이면 시각만 갖는다. 없거나 지운 태스크면 null 이다', () => {
  const tasksOf = (reminders: ReminderDto[]) => toBundle(bundleDto({ reminders }))?.tasks
  expect(
    tasksOf([
      reminderDto({
        reason: '9/16(수)에 태스크를 만든 뒤로 진행 소식이 없어요.',
        evidence: { kind: 'task_change', at: '2026-09-17T01:00:00Z', message_id: null },
      }),
      reminderDto({ reason: '9/16(수)에 태스크를 만든 뒤로 진행 소식이 없어요.', evidence: null }),
      reminderDto({
        task_id: null,
        task_title: null,
        due_date: null,
        reason: null,
        evidence: null,
      }),
    ]),
  ).toMatchObject([
    {
      reason: '9/16(수)에 태스크를 만든 뒤로 진행 소식이 없어요.',
      evidence: { kind: 'taskChange', at: '2026-09-17T01:00:00Z' },
    },
    { reason: '9/16(수)에 태스크를 만든 뒤로 진행 소식이 없어요.', evidence: null },
    { title: null, reason: null, evidence: null },
  ])
  // 메시지 ID 없는 답장 근거는 이동할 곳이 없다 — 이유 문장만 남기고 근거를 뺀다
  expect(
    tasksOf([
      reminderDto({
        reason: '9/5(토) 이후로 진행 소식이 없어요.',
        evidence: { kind: 'reply', at: '2026-09-05T01:00:00Z', message_id: null },
      }),
    ]),
  ).toMatchObject([{ reason: '9/5(토) 이후로 진행 소식이 없어요.', evidence: null }])
})

it('#418 이전 서버처럼 요약·이유·근거 칸이 없으면 요약은 태스크 제목으로 줄이고 이유·근거는 null 이다', () => {
  const legacy = (reminders: ReminderDto[]) => {
    const dto = bundleDto({ reminders })
    delete dto.summary
    return toBundle(dto)
  }
  expect(legacy([reminderDto()])).toMatchObject({
    summary: 'API 명세서',
    tasks: [{ reason: null, evidence: null }],
  })
  expect(
    legacy([
      reminderDto({ task_id: null, task_title: null, due_date: null }),
      reminderDto({ reminder_id: 'rm_02', task_title: '발표 자료' }),
    ])?.summary,
  ).toBe('지워진 태스크 외 1건')
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

it('PM 메시지는 DM 상태와 작성자를 갖고, 작성자 칸이 비어 와도 메시지는 읽는다', () => {
  expect(toMessage(pmDto())).toEqual({
    sender: 'pm',
    id: 'mg_03',
    body: '오늘 회의 전에 한 번 봐 주세요',
    createdAt: '2026-09-16T09:00:00Z',
    dm: { status: 'pending' },
    authorMemberId: 'mb_01',
    authorName: '김서연',
  })
  expect(
    toMessage(pmDto({ dm_status: 'failed', dm_failure_reason: 'discord_not_linked' })),
  ).toMatchObject({ dm: { status: 'failed', reason: 'discord_not_linked' } })
  expect(toMessage(pmDto({ author_member_id: null, author_name: null }))).toMatchObject({
    sender: 'pm',
    authorMemberId: null,
    authorName: null,
  })
})

it('보낸 쪽과 칸이 맞지 않으면 던진다', () => {
  expect(() => toMessage(botDto({ dm_status: null }))).toThrow(/mg_01/)
  expect(() => toMessage(pmDto({ dm_status: null }))).toThrow(/mg_03/)
  expect(() => toMessage(memberDto({ reply_channel: null }))).toThrow(/mg_02/)
})

it('웹 답장 가능 여부는 세 가지다 — 칸이 없는 옛 응답은 어느 쪽으로도 단정하지 않는다', () => {
  const webReplyOf = (patch: Partial<ThreadSummaryDto>) =>
    toMessageInbox({ threads: [{ ...summaryDto, ...patch }], bundles: null }).threads[0].webReply
  expect(webReplyOf({ web_reply_available: true })).toBe('available')
  expect(webReplyOf({ web_reply_available: false })).toBe('unavailable')
  const legacy = { ...summaryDto }
  delete legacy.web_reply_available
  expect(toMessageInbox({ threads: [legacy], bundles: null }).threads[0].webReply).toBe('unknown')
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

it('만든 재촉은 리마인드 ID 와 그것이 든 예정 묶음이고, 묶음이 예정이 아니면 계약 위반으로 던진다', () => {
  const dto = bundleDto()
  const created = toCreatedReminder({ reminder: dto.reminders[0], bundle: dto })
  expect(created.bundle.summary).toBe('API 명세서 진행 상황 확인')
  expect(created.reminderId).toBe('rm_01')
  expect(created.bundle).toMatchObject({ id: 'bd_01', stage: 'awaitingApproval', draftVersion: 2 })
  expect(() =>
    toCreatedReminder({ reminder: dto.reminders[0], bundle: bundleDto({ status: 'cancelled' }) }),
  ).toThrow('bd_01')
})

describe('toReplyAttribution', () => {
  it('PM 이 고를 답장은 후보를, 고른 답장은 고른 태스크를 쓴다. 해당 없음은 null 이다', () => {
    expect(
      toReplyAttribution({
        message_id: 'mg_05',
        status: 'needs_pm',
        candidates: [
          { task_id: 'tk_02', title: '회원가입 화면' },
          { task_id: 'tk_05', title: '회의록 요약 검수' },
        ],
        task: null,
      }),
    ).toEqual({
      messageId: 'mg_05',
      kind: 'needsPick',
      candidates: [
        { id: 'tk_02', title: '회원가입 화면' },
        { id: 'tk_05', title: '회의록 요약 검수' },
      ],
    })
    expect(
      toReplyAttribution({
        message_id: 'mg_05',
        status: 'resolved',
        candidates: null,
        task: { task_id: 'tk_02', title: '회원가입 화면' },
      }),
    ).toEqual({ messageId: 'mg_05', kind: 'picked', task: { id: 'tk_02', title: '회원가입 화면' } })
    expect(
      toReplyAttribution({ message_id: 'mg_05', status: 'resolved', candidates: null, task: null }),
    ).toEqual({ messageId: 'mg_05', kind: 'picked', task: null })
  })
})
