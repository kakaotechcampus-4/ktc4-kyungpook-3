import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest, signUpVerified } from '@/shared/test/api'
import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ReminderWithBundleDto,
  ThreadDetailDto,
  ThreadSummaryDto,
} from '@/shared/types/api/message'
import type { ListDto } from '@/shared/types/api/envelope'
import type { AttributionResponseDto, ReplyAttributionDto } from '@/shared/types/api/reply'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb, replaceDb, resetDb } from './db'
import { messagesMemberThread } from './fixtures/message'
import { MOCK_DB_STORAGE_KEY, restoreDb, saveDb } from './persistence'
import { setMockRole } from './sessions'
import { applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'

/*
 * 메시지 handler 와 시나리오 (계약 §5.7, 계획 C-7). 경로·모양·오류 코드가 백엔드 api/messages.py 와 같은지 본다.
 * 화면 흐름은 app/messagesMsw.test.tsx 가 본다.
 */

const MESSAGE_SCENARIOS = [
  'messages-default',
  'messages-empty',
  'messages-list-error',
  'messages-thread-error',
  'messages-send-fail',
  'messages-member',
  'messages-member-push',
  'messages-pm-self',
  'messages-schedule-passed',
  'messages-merge',
  'messages-long-content',
  'messages-pm-thread',
] as const satisfies readonly MockScenario[]

afterEach(() => sessionStorage.clear())

const base = (workspaceId = 'ws_01') => `/workspaces/${workspaceId}/messages`
const inbox = (workspaceId = 'ws_01') => fetchDto<InboxDto>(base(workspaceId))
const thread = (threadId: string, workspaceId = 'ws_01') =>
  fetchDto<ThreadDetailDto>(`${base(workspaceId)}/threads/${threadId}`)
const patchBundle = (bundleId: string, body: unknown, workspaceId?: string) =>
  fetchDto<BundleDto>(`${base(workspaceId)}/bundles/${bundleId}`, jsonRequest('PATCH', body))
const approve = (bundleId: string, body: unknown, workspaceId?: string) =>
  fetchDto<BundleDto>(`${base(workspaceId)}/bundles/${bundleId}/approve`, jsonRequest('POST', body))
const cancel = (bundleId: string, workspaceId?: string) =>
  fetchDto<BundleDto>(`${base(workspaceId)}/bundles/${bundleId}/cancel`, { method: 'POST' })
const replyTo = (threadId: string, body: unknown, workspaceId = 'ws_01') =>
  fetchDto<MessageDto>(
    `${base(workspaceId)}/threads/${threadId}/replies`,
    jsonRequest('POST', { body }),
  )
const openThreadFor = (memberId: unknown, workspaceId = 'ws_01') =>
  fetchDto<ThreadSummaryDto>(
    `${base(workspaceId)}/threads`,
    jsonRequest('POST', { member_id: memberId }),
  )
const snapshot = () => structuredClone({ bundles: db.messageBundles, threads: db.messageThreads })

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected the request to fail')
}

describe('메시지 조회 handler', () => {
  it('PM 의 목록은 최근 대화 순과 예정 묶음(나갈 시각 순)이고, 시각은 UTC 다', async () => {
    const { threads, bundles } = await inbox()
    expect(threads.map(({ thread_id }) => thread_id)).toEqual(['th_01', 'th_02', 'th_03', 'th_04'])
    expect(threads[0]).toEqual({
      thread_id: 'th_01',
      member_id: 'mb_03',
      name: '이재환',
      last_message: {
        message_id: 'mg_03',
        sender: 'bot',
        body: 'DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?',
        created_at: '2026-09-16T09:00:00.000Z',
        author_member_id: null,
        author_name: null,
      },
      awaiting_reply_since: '2026-09-16T09:00:00.000Z',
      dm_failed: false,
      web_reply_available: false,
    })
    expect(threads.map(({ dm_failed }) => dm_failed)).toEqual([false, false, false, true])
    expect(bundles?.map(({ bundle_id, scheduled_at }) => [bundle_id, scheduled_at])).toEqual([
      ['bd_01', '2026-09-23T00:00:00.000Z'],
      ['bd_02', '2026-09-25T05:00:00.000Z'],
    ])
    expect(JSON.stringify({ threads, bundles })).not.toContain('workspace_id')
  })

  it('공간마다 따로다 — ws_02 의 PM 은 ws_01 의 대화를 보지 않는다', async () => {
    setMockRole('pm', 'ws_02')
    const { threads, bundles } = await inbox('ws_02')
    expect(threads.map(({ thread_id }) => thread_id)).toEqual(['th_11'])
    expect(bundles).toEqual([])
  })

  it('대화는 요약·시각 순 메시지·그 대화의 예정 묶음이다. 없는 대화나 다른 공간의 대화는 404 다', async () => {
    const detail = await thread('th_01')
    expect(detail.thread.thread_id).toBe('th_01')
    expect(detail.messages.map(({ message_id, thread_id }) => [message_id, thread_id])).toEqual([
      ['mg_01', 'th_01'],
      ['mg_02', 'th_01'],
      ['mg_03', 'th_01'],
    ])
    expect(detail.bundles?.map(({ bundle_id }) => bundle_id)).toEqual(['bd_01'])
    expect(detail.messages[0]).toMatchObject({ dm_status: 'delivered', reply_channel: null })
    expect(detail.messages[1]).toMatchObject({ dm_status: null, reply_channel: 'discord' })

    const failed = await thread('th_04')
    expect(failed.messages[0]).toMatchObject({
      dm_status: 'failed',
      dm_failure_reason: 'dm_blocked',
    })

    for (const path of [thread('th_99'), thread('th_11')]) {
      const error = await failure(path)
      expect([error.status, error.code]).toEqual([404, 'MESSAGE_THREAD_NOT_FOUND'])
    }
  })

  it('조회는 db 를 바꾸지 않는다', async () => {
    const before = snapshot()
    await inbox()
    await thread('th_01')
    expect(snapshot()).toEqual(before)
  })
})

describe('보낼 메시지 handler — 성공할 때만 db 를 바꾼다 (D-137)', () => {
  it('승인: 보는 판으로 승인하면 승인된 묶음이 목록에 남는다', async () => {
    const approved = await approve('bd_01', { draft_version: 2 })
    expect(approved).toMatchObject({
      bundle_id: 'bd_01',
      approved: true,
      approved_at: '2026-09-18T00:00:00.000Z',
    })
    expect((await inbox()).bundles?.map(({ approved: done }) => done)).toEqual([true, false])
    // 이미 승인했으면 판이 달라도 그대로 200 이다
    expect(await approve('bd_01', { draft_version: 1 })).toMatchObject({ approved: true })
  })

  it('승인: 판이 다르면 409 BUNDLE_CHANGED, 판이 없으면 400 이고 db 는 그대로다', async () => {
    const before = snapshot()
    const changed = await failure(approve('bd_01', { draft_version: 1 }))
    expect([changed.status, changed.code]).toEqual([409, 'BUNDLE_CHANGED'])
    const missing = await failure(approve('bd_01', {}))
    expect([missing.status, missing.code]).toEqual([400, 'INVALID_REQUEST'])
    expect(snapshot()).toEqual(before)
  })

  it('보내지 않음: 목록과 대화의 예정에서 빠지고, 다시 하면 409 REMINDER_NOT_EDITABLE 이다', async () => {
    expect(await cancel('bd_01')).toMatchObject({ status: 'cancelled' })
    expect((await inbox()).bundles?.map(({ bundle_id }) => bundle_id)).toEqual(['bd_02'])
    expect((await thread('th_01')).bundles).toEqual([])
    const again = await failure(cancel('bd_01'))
    expect([again.status, again.code]).toEqual([409, 'REMINDER_NOT_EDITABLE'])
    const gone = await failure(approve('bd_01', { draft_version: 2 }))
    expect([gone.status, gone.code]).toEqual([409, 'REMINDER_NOT_EDITABLE'])
  })

  it('문구·시각 고치기: 문구는 PM 문구가 되고 판이 오른다. 시각은 시간대가 있어야 하고 지난 시각은 409 다', async () => {
    expect(await patchBundle('bd_02', { body: '  고친 문구  ' })).toMatchObject({
      body: '고친 문구',
      body_source: 'pm',
      draft_status: 'done',
      draft_version: 2,
    })
    expect(await patchBundle('bd_02', { scheduled_at: '2026-09-26T10:00:00+09:00' })).toMatchObject(
      { scheduled_at: '2026-09-26T01:00:00.000Z', draft_version: 2 },
    )

    const before = snapshot()
    for (const [body, status, code] of [
      [{}, 400, 'INVALID_REQUEST'],
      [{ body: '   ' }, 400, 'INVALID_REQUEST'],
      [{ scheduled_at: '2026-09-26T10:00' }, 400, 'INVALID_REQUEST'],
      [{ scheduled_at: '2026-09-17T10:00:00+09:00' }, 409, 'REMINDER_SCHEDULED_AT_PASSED'],
    ] as const) {
      const error = await failure(patchBundle('bd_02', body))
      expect([error.status, error.code]).toEqual([status, code])
    }
    expect(snapshot()).toEqual(before)
  })

  it('없는 묶음과 다른 공간의 묶음은 404 REMINDER_BUNDLE_NOT_FOUND 이고, PM 이 아니면 403 이다', async () => {
    setMockRole('pm', 'ws_02')
    for (const request of [approve('bd_99', { draft_version: 1 }), cancel('bd_01', 'ws_02')]) {
      const error = await failure(request)
      expect([error.status, error.code]).toEqual([404, 'REMINDER_BUNDLE_NOT_FOUND'])
    }
    setMockRole('member')
    const denied = await failure(approve('bd_01', { draft_version: 2 }))
    expect([denied.status, denied.code]).toEqual([403, 'FORBIDDEN'])
  })
})

const createReminder = (body: unknown, workspaceId?: string) =>
  fetchDto<ReminderWithBundleDto>(`${base(workspaceId)}/reminders`, jsonRequest('POST', body))
const patchReminder = (reminderId: string, body: unknown) =>
  fetchDto<ReminderWithBundleDto>(`${base()}/reminders/${reminderId}`, jsonRequest('PATCH', body))
const cancelReminder = (reminderId: string) =>
  fetchDto<ReminderWithBundleDto>(`${base()}/reminders/${reminderId}/cancel`, { method: 'POST' })
const NEW_REMINDER = {
  member_id: 'mb_02',
  task_id: 'tk_02',
  scheduled_at: '2026-09-21T09:00:00+09:00',
}

describe('묶음 응답의 요약·재촉 이유·근거 — 백엔드 reminder_reason', () => {
  const reasons = (bundle: BundleDto) =>
    bundle.reminders.map(({ reminder_id, reason, evidence }) => ({ reminder_id, reason, evidence }))

  it('목록과 대화의 묶음마다 요약을, 태스크마다 이유와 마지막 진행 소식을 싣는다. PM 이 만든 재촉은 만든 PM 의 이름이다', async () => {
    applyScenario('messages-default')
    const { bundles } = await inbox()
    expect(bundles?.map(({ summary }) => summary)).toEqual([
      '배포 스크립트 진행 상황 확인',
      '퍼블리싱 외 1건 진행 상황 확인',
    ])
    const expected = [
      [
        {
          reminder_id: 'rm_01',
          reason: "'배포 스크립트' 마감이 9/24(목)인데, 9/17(목) 이후로 진행 소식이 없어요.",
          evidence: { kind: 'task_change', at: '2026-09-17T06:00:00.000Z', message_id: null },
        },
      ],
      [
        {
          reminder_id: 'rm_02',
          reason: '9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
          evidence: null,
        },
        {
          reminder_id: 'rm_03',
          reason:
            '김서연님이 직접 만든 재촉이에요. 9/15(화)에 태스크를 만든 뒤로 진행 소식이 없어요.',
          evidence: null,
        },
      ],
    ]
    expect(bundles?.map(reasons)).toEqual(expected)
    expect((await thread('th_03')).bundles?.map(reasons)).toEqual([expected[1]])
  })

  it('messages-merge 의 bd_07 은 대화의 팀원 답장이 근거다', async () => {
    applyScenario('messages-merge')
    const merging = (await inbox()).bundles?.find(({ bundle_id }) => bundle_id === 'bd_07')
    expect(merging && reasons(merging)).toEqual([
      {
        reminder_id: 'rm_07',
        reason: "'ERD 정리' 마감이 9/24(목)인데, 9/15(화) 이후로 진행 소식이 없어요.",
        evidence: { kind: 'reply', at: '2026-09-15T00:31:00.000Z', message_id: 'mg_02' },
      },
    ])
  })

  it('태스크의 제목·마감을 고치면 다음 조회의 제목·마감·요약·이유가 지금 태스크를 따른다', async () => {
    applyScenario('messages-default')
    const task = db.tasks.find(({ task_id }) => task_id === 'tk_04')!
    task.title = '배포 스크립트 정리'
    task.due_date = '2026-11-14'
    const bundle = (await inbox()).bundles?.find(({ bundle_id }) => bundle_id === 'bd_01')
    expect(bundle?.summary).toBe('배포 스크립트 정리 진행 상황 확인')
    expect(bundle?.reminders[0]).toMatchObject({
      task_title: '배포 스크립트 정리',
      due_date: '2026-11-14',
      reason: "'배포 스크립트 정리' 마감이 11/14(토)인데, 9/17(목) 이후로 진행 소식이 없어요.",
    })
  })

  it('재촉 만들기 응답은 리마인드와 묶음 모두 이유를 싣고, 만든 사람은 요청한 PM 이다', async () => {
    const created = await createReminder(NEW_REMINDER)
    const reason =
      '김서연님이 직접 만든 재촉이에요. 9/10(목)에 태스크를 만든 뒤로 진행 소식이 없어요.'
    expect(created.reminder).toMatchObject({ reason, evidence: null })
    expect(created.bundle).toMatchObject({
      summary: '회원가입 화면 진행 상황 확인',
      reminders: [{ reason, evidence: null }],
    })
  })
})

describe('리마인드 handler — 백엔드 api/messages.py 의 reminders 경로', () => {
  it('만들기: 201 로 리마인드와 그것이 든 예정 묶음을 주고, 목록에 새 묶음이 보인다', async () => {
    const created = await createReminder({ ...NEW_REMINDER, note: '  ' })
    expect(created.reminder).toMatchObject({ task_id: 'tk_02', note: null, origin: 'pm' })
    expect(created.bundle).toMatchObject({
      member_id: 'mb_02',
      status: 'scheduled',
      scheduled_at: '2026-09-21T00:00:00.000Z',
      draft_version: 1,
    })
    expect((await inbox()).bundles?.map(({ bundle_id }) => bundle_id)).toContain(
      created.bundle.bundle_id,
    )
    const again = await createReminder(NEW_REMINDER)
    expect(again.reminder.reminder_id).toBe(created.reminder.reminder_id)
  })

  it('만들기: 없는 태스크·팀원은 404, 지난 시각은 409, 칸이 빠졌거나 시간대가 없으면 400 이고 db 는 그대로다', async () => {
    const before = snapshot()
    for (const [body, status, code] of [
      [{ ...NEW_REMINDER, task_id: 'tk_99' }, 404, 'TASK_NOT_FOUND'],
      [{ ...NEW_REMINDER, member_id: 'mb_99' }, 404, 'MEMBER_NOT_FOUND'],
      [
        { ...NEW_REMINDER, scheduled_at: '2026-09-17T09:00:00+09:00' },
        409,
        'REMINDER_SCHEDULED_AT_PASSED',
      ],
      [{ ...NEW_REMINDER, scheduled_at: '2026-09-21T09:00:00' }, 400, 'INVALID_REQUEST'],
      [{ member_id: 'mb_02', scheduled_at: NEW_REMINDER.scheduled_at }, 400, 'INVALID_REQUEST'],
    ] as const) {
      const error = await failure(createReminder(body))
      expect([error.status, error.code]).toEqual([status, code])
    }
    expect(snapshot()).toEqual(before)
  })

  it('메모 고치기: 메모가 바뀌면 판이 오르고, 바꿀 것이 없으면 400, 없는 리마인드는 404 다', async () => {
    const edited = await patchReminder('rm_02', { note: '시안 3차까지' })
    expect(edited.reminder.note).toBe('시안 3차까지')
    expect(edited.bundle).toMatchObject({ bundle_id: 'bd_02', draft_version: 2, approved: false })
    const cleared = await patchReminder('rm_02', { note: '' })
    expect(cleared.reminder.note).toBeNull()

    const empty = await failure(patchReminder('rm_02', {}))
    expect([empty.status, empty.code]).toEqual([400, 'INVALID_REQUEST'])
    const missing = await failure(patchReminder('rm_99', { note: 'x' }))
    expect([missing.status, missing.code]).toEqual([404, 'REMINDER_NOT_FOUND'])
  })

  it('빼기: 남은 태스크가 있으면 예정 묶음이, 마지막이면 취소된 묶음이 오고 목록에서 빠진다. 다시 빼면 409 다', async () => {
    const first = await cancelReminder('rm_02')
    expect(first.bundle.status).toBe('scheduled')
    expect(first.bundle.reminders.map(({ reminder_id }) => reminder_id)).toEqual(['rm_03'])

    const last = await cancelReminder('rm_03')
    expect(last.bundle.status).toBe('cancelled')
    expect((await inbox()).bundles?.map(({ bundle_id }) => bundle_id)).toEqual(['bd_01'])

    const again = await failure(cancelReminder('rm_03'))
    expect([again.status, again.code]).toEqual([409, 'REMINDER_NOT_EDITABLE'])
    const edit = await failure(patchReminder('rm_03', { note: 'x' }))
    expect([edit.status, edit.code]).toEqual([409, 'REMINDER_NOT_EDITABLE'])
  })

  it('PM 이 아니면 세 경로 모두 403 이고, 다른 공간의 리마인드는 404 다', async () => {
    setMockRole('pm', 'ws_02')
    const elsewhere = await failure(
      fetchDto(`${base('ws_02')}/reminders/rm_02/cancel`, { method: 'POST' }),
    )
    expect([elsewhere.status, elsewhere.code]).toEqual([404, 'REMINDER_NOT_FOUND'])
    setMockRole('member')
    for (const request of [
      createReminder(NEW_REMINDER),
      patchReminder('rm_02', { note: 'x' }),
      cancelReminder('rm_02'),
    ]) {
      const error = await failure(request)
      expect([error.status, error.code]).toEqual([403, 'FORBIDDEN'])
    }
  })
})

const attributions = (threadId: string) =>
  fetchDto<ListDto<ReplyAttributionDto>>(`${base()}/threads/${threadId}/attributions`)
const attribute = (messageId: string, body: unknown) =>
  fetchDto<AttributionResponseDto>(
    `${base()}/replies/${messageId}/attribution`,
    jsonRequest('POST', body),
  )
const NEEDS_PICK: ReplyAttributionDto = {
  message_id: 'mg_05',
  status: 'needs_pm',
  candidates: [
    { task_id: 'tk_02', title: '회원가입 화면' },
    { task_id: 'tk_05', title: '회의록 요약 검수' },
  ],
  task: null,
}

describe('답장 고르기 handler — 백엔드 api/messages.py 의 attributions·attribution 경로', () => {
  beforeEach(() => applyScenario('reply-judgment'))

  it('PM 이 고를 답장은 후보와 함께 오고, 고를 답장이 없는 대화는 비어 있다', async () => {
    expect(await attributions('th_02')).toEqual({ items: [NEEDS_PICK], total: 1 })
    expect(await attributions('th_01')).toEqual({ items: [], total: 0 })
    const missing = await failure(attributions('th_99'))
    expect([missing.status, missing.code]).toEqual([404, 'MESSAGE_THREAD_NOT_FOUND'])
  })

  it('태스크를 고르면 고른 답장이 되고, 다시 고르면 409 REPLY_ATTRIBUTION_NOT_NEEDED 다', async () => {
    expect(await attribute('mg_05', { task_id: 'tk_02' })).toEqual({ message_id: 'mg_05' })
    expect((await attributions('th_02')).items).toEqual([
      {
        message_id: 'mg_05',
        status: 'resolved',
        candidates: null,
        task: { task_id: 'tk_02', title: '회원가입 화면' },
      },
    ])
    const again = await failure(attribute('mg_05', { task_id: 'tk_05' }))
    expect([again.status, again.code]).toEqual([409, 'REPLY_ATTRIBUTION_NOT_NEEDED'])
  })

  it('해당 없음(null)으로 고르면 태스크 없이 고른 답장이 된다', async () => {
    expect(await attribute('mg_05', { task_id: null })).toEqual({ message_id: 'mg_05' })
    expect((await attributions('th_02')).items).toEqual([
      { message_id: 'mg_05', status: 'resolved', candidates: null, task: null },
    ])
  })

  it('후보가 아닌 태스크·task_id 가 없는 본문은 400, 판단이 없는 답장은 404 이고 고르기는 그대로다', async () => {
    for (const body of [{ task_id: 'tk_01' }, {}, { task_id: 3 }]) {
      const error = await failure(attribute('mg_05', body))
      expect([error.status, error.code]).toEqual([400, 'INVALID_REQUEST'])
    }
    const missing = await failure(attribute('mg_99', { task_id: 'tk_02' }))
    expect([missing.status, missing.code]).toEqual([404, 'REPLY_JUDGMENT_NOT_FOUND'])
    expect((await attributions('th_02')).items).toEqual([NEEDS_PICK])
  })

  it('PM 이 아니면 두 경로 모두 403 이고 고르기는 그대로다', async () => {
    applyScenario('reply-judgment-member')
    for (const request of [attributions('th_02'), attribute('mg_05', { task_id: 'tk_02' })]) {
      const error = await failure(request)
      expect([error.status, error.code]).toEqual([403, 'FORBIDDEN'])
    }
    setMockRole('pm')
    expect((await attributions('th_02')).items).toEqual([NEEDS_PICK])
  })
})

describe('대화 열기 handler — 백엔드 api/messages.py 의 open_thread', () => {
  it('PM 은 공간의 누구든 연다. 있으면 그 대화, 없으면 빈 대화를 만들고 몇 번 열어도 하나다 — 늘 200 이다', async () => {
    expect(await openThreadFor('mb_03')).toMatchObject({ thread_id: 'th_01', member_id: 'mb_03' })
    const created = await openThreadFor('mb_01')
    expect(created).toEqual({
      thread_id: 'th_12',
      member_id: 'mb_01',
      name: '김서연',
      last_message: null,
      awaiting_reply_since: null,
      dm_failed: false,
      web_reply_available: true,
    })
    expect(await openThreadFor('mb_01')).toEqual(created)
    expect((await inbox()).threads.map(({ thread_id }) => thread_id)).toContain('th_12')
  })

  it('팀원은 자기 대화만 연다 — 남의 대화는 403, 없는 팀원은 404 이고 db 는 그대로다', async () => {
    applyScenario('messages-member')
    expect(await openThreadFor('mb_01')).toMatchObject({ thread_id: 'th_06' })
    const before = snapshot()
    const other = await failure(openThreadFor('mb_03'))
    expect([other.status, other.code]).toEqual([403, 'FORBIDDEN'])
    setMockRole('pm')
    const missing = await failure(openThreadFor('mb_99'))
    expect([missing.status, missing.code]).toEqual([404, 'MEMBER_NOT_FOUND'])
    expect((await failure(openThreadFor(7))).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })
})

describe('메시지 시나리오', () => {
  it('messages-empty: ws_01 의 묶음·대화가 모두 없다', async () => {
    applyScenario('messages-empty')
    expect(await inbox()).toEqual({ threads: [], bundles: [] })
  })

  it('messages-list-error: 목록만 5xx 이고 대화는 받는다', async () => {
    applyScenario('messages-list-error')
    expect((await failure(inbox())).status).toBe(500)
    expect((await thread('th_01')).thread.name).toBe('이재환')
  })

  it('messages-thread-error: 목록은 받고 th_01 만 5xx 다', async () => {
    applyScenario('messages-thread-error')
    expect((await inbox()).threads).toHaveLength(4)
    expect((await failure(thread('th_01'))).status).toBe(500)
    expect((await thread('th_02')).thread.name).toBe('박민수')
  })

  it('messages-member: 자기 대화만 보고 bundles 는 null 이다. 남의 대화는 403 이고 PM 행동도 403 이다', async () => {
    applyScenario('messages-member')
    const { threads, bundles } = await inbox()
    expect(threads.map(({ thread_id }) => thread_id)).toEqual(['th_06'])
    expect(bundles).toBeNull()
    expect((await thread('th_06')).bundles).toBeNull()
    const other = await failure(thread('th_01'))
    expect([other.status, other.code]).toEqual([403, 'FORBIDDEN'])

    const before = snapshot()
    for (const request of [
      approve('bd_05', { draft_version: 1 }),
      cancel('bd_05'),
      patchBundle('bd_05', { body: 'x' }),
    ])
      expect((await failure(request)).status).toBe(403)
    expect(snapshot()).toEqual(before)
  })

  it('messages-member-push: messages-member 에 서버 푸시 공개키만 더했다', async () => {
    applyScenario('messages-member-push')
    await expect(fetchDto('/push/vapid-public-key')).resolves.toEqual({ public_key: 'AQID' })
    expect({ ...db, push: initialDb().push }).toEqual(createScenarioDb('messages-member'))
  })

  it('답장은 대화 주인만 한다 — 웹 답장은 201 로 대화에 남고 답장 대기를 끝낸다. 빈 답장은 400 이다', async () => {
    applyScenario('messages-member')
    const created = await replyTo('th_06', '  웹에서 한 줄 더  ')
    expect(created).toMatchObject({
      thread_id: 'th_06',
      sender: 'member',
      body: '웹에서 한 줄 더',
      reply_channel: 'web',
      dm_status: null,
      created_at: '2026-09-18T00:00:00.000Z',
    })
    expect((await thread('th_06')).thread.awaiting_reply_since).toBeNull()
    expect((await failure(replyTo('th_06', '   '))).status).toBe(400)
    const other = await failure(replyTo('th_01', '남의 대화'))
    expect([other.status, other.code]).toEqual([403, 'FORBIDDEN'])
  })

  it('PM 이 남의 대화에 쓰면 작성자가 붙은 PM 글로 201 이고, Discord 가 없는 팀원에게는 못 보냄으로 남는다', async () => {
    const created = await replyTo('th_01', '  재환님, 확인 부탁해요  ')
    expect(created).toEqual({
      message_id: 'mg_22',
      thread_id: 'th_01',
      sender: 'pm',
      body: '재환님, 확인 부탁해요',
      created_at: '2026-09-18T00:00:00.000Z',
      reply_channel: null,
      dm_status: 'failed',
      dm_failure_reason: 'discord_not_linked',
      scheduled_at: null,
      author_member_id: 'mb_01',
      author_name: '김서연',
    })
    const { thread: summary } = await thread('th_01')
    expect(summary.last_message).toMatchObject({ sender: 'pm', author_name: '김서연' })
    // PM 글은 답장 기다림을 끝내지도 새로 열지도 않는다
    expect(summary.awaiting_reply_since).toBe('2026-09-16T09:00:00.000Z')
    expect(summary.dm_failed).toBe(true)
    await expect(replyTo('th_02', '민수님 확인했어요')).resolves.toMatchObject({
      sender: 'pm',
      dm_status: 'pending',
      dm_failure_reason: null,
    })
  })

  it('받는 팀원이 공간에 없는 대화에는 쓰지 않는다 (404 MEMBER_NOT_FOUND)', async () => {
    const before = snapshot()
    const error = await failure(replyTo('th_04', '지훈님'))
    expect([error.status, error.code]).toEqual([404, 'MEMBER_NOT_FOUND'])
    expect(snapshot()).toEqual(before)
  })

  it('messages-pm-self: 공간 응답의 member_id 는 PM 의 팀원 행이고, 그 행의 대화 th_06 에만 답장된다', async () => {
    applyScenario('messages-pm-self')
    const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
    expect(
      items.map(({ workspace_id, role, member_id }) => [workspace_id, role, member_id]),
    ).toEqual([['ws_01', 'pm', 'mb_01']])
    expect((await fetchDto<WorkspaceDto>('/workspaces/ws_01')).member_id).toBe('mb_01')
    expect((await inbox()).threads.map(({ thread_id }) => thread_id)).toContain('th_06')

    const created = await replyTo('th_06', 'PM 이 자기 대화에 남긴 답장')
    expect(created).toMatchObject({ thread_id: 'th_06', sender: 'member', reply_channel: 'web' })
    expect((await thread('th_06')).messages.at(-1)?.body).toBe('PM 이 자기 대화에 남긴 답장')

    await expect(replyTo('th_01', '남의 대화')).resolves.toMatchObject({
      sender: 'pm',
      author_member_id: 'mb_01',
    })
  })

  it('새 공간을 만든 계정은 그 공간의 PM 행이 member_id 이고, 그 행의 대화에 답장된다. 다른 팀원 계정은 403 이다', async () => {
    applyScenario('messages-pm-self')
    const created = await fetchDto<WorkspaceDto>(
      '/workspaces',
      jsonRequest('POST', { name: '새 공간' }),
    )
    const workspaceId = created.workspace_id
    const creator = db.members.find(
      ({ workspace_id, role }) => workspace_id === workspaceId && role === 'pm',
    )
    expect(creator).toBeDefined()
    const creatorId = creator?.member_id
    expect(created.member_id).toBe(creatorId)
    const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
    expect(items.find(({ workspace_id }) => workspace_id === workspaceId)?.member_id).toBe(
      creatorId,
    )
    expect((await fetchDto<WorkspaceDto>(`/workspaces/${workspaceId}`)).member_id).toBe(creatorId)

    db.messageThreads.push({
      ...structuredClone(messagesMemberThread),
      thread_id: 'th_90',
      workspace_id: workspaceId,
      member_id: creatorId ?? '',
    })
    await expect(replyTo('th_90', '만든 사람의 답장', workspaceId)).resolves.toMatchObject({
      thread_id: 'th_90',
      sender: 'member',
    })

    await signUpVerified({ email: 'other@example.com', password: 'pass1234', name: '다른 팀원' })
    db.members.push({ ...structuredClone(creator!), member_id: 'mb_91', role: 'member' })
    const other = db.accounts.find(({ session }) => session.user.email === 'other@example.com')
    other!.workspaceIds.push(workspaceId)
    other!.memberIds[workspaceId] = 'mb_91'
    // 공간 행의 역할은 계정끼리 같이 쓴다 — 다른 계정을 팀원으로 본다. PM 이면 남의 대화에도 PM 글로 쓴다
    setMockRole('member', workspaceId)
    expect((await fetchDto<WorkspaceDto>(`/workspaces/${workspaceId}`)).member_id).toBe('mb_91')
    const before = snapshot()
    const refused = await failure(replyTo('th_90', '남의 대화', workspaceId))
    expect([refused.status, refused.code]).toEqual([403, 'FORBIDDEN'])
    expect(snapshot()).toEqual(before)
  })

  it('messages-schedule-passed: 지난 묶음 승인은 409 REMINDER_SCHEDULED_AT_PASSED 이고, 시각을 옮기면 승인된다', async () => {
    applyScenario('messages-schedule-passed')
    const error = await failure(approve('bd_06', { draft_version: 1 }))
    expect([error.status, error.code]).toEqual([409, 'REMINDER_SCHEDULED_AT_PASSED'])
    await patchBundle('bd_06', { scheduled_at: '2026-09-19T09:00:00+09:00' })
    expect(await approve('bd_06', { draft_version: 1 })).toMatchObject({ approved: true })
  })

  it('messages-merge: 같은 대화의 예정 묶음 시각으로 옮기면 합친 묶음이 오고, 문구도 같이 보내면 400 이다', async () => {
    applyScenario('messages-merge')
    const before = snapshot()
    const refused = await failure(
      patchBundle('bd_07', { body: '고친 문구', scheduled_at: '2026-09-23T09:00:00+09:00' }),
    )
    expect([refused.status, refused.code]).toEqual([400, 'INVALID_REQUEST'])
    expect(snapshot()).toEqual(before)

    expect(await patchBundle('bd_07', { scheduled_at: '2026-09-23T09:00:00+09:00' })).toMatchObject(
      {
        bundle_id: 'bd_01',
        approved: false,
        approved_at: null,
        draft_version: 3,
      },
    )
    expect((await inbox()).bundles?.map(({ bundle_id }) => bundle_id)).toEqual(['bd_01', 'bd_02'])
  })

  it('messages-send-fail: 조회는 되고 행동은 모두 5xx 이며 db 는 그대로다', async () => {
    applyScenario('messages-send-fail')
    expect((await inbox()).threads).toHaveLength(4)
    const before = snapshot()
    for (const request of [
      approve('bd_01', { draft_version: 2 }),
      cancel('bd_01'),
      patchBundle('bd_01', { body: '고친 문구' }),
      createReminder(NEW_REMINDER),
      patchReminder('rm_02', { note: 'x' }),
      cancelReminder('rm_02'),
    ])
      expect((await failure(request)).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it('messages-pm-thread: 다른 PM 의 글과 내 글이 있고, 웹 계정이 이어진 박민수만 웹 답장이 된다', async () => {
    applyScenario('messages-pm-thread')
    const { threads } = await inbox()
    const byId = (id: string) => threads.find(({ thread_id }) => thread_id === id)
    expect(byId('th_01')).toMatchObject({
      last_message: { sender: 'pm', author_member_id: 'mb_06', author_name: '오지현' },
      dm_failed: true,
      web_reply_available: false,
    })
    expect(byId('th_02')).toMatchObject({
      last_message: { sender: 'pm', author_member_id: 'mb_01', author_name: '김서연' },
      dm_failed: false,
      web_reply_available: true,
    })
  })

  it('저장 버전 6 은 버린다', () => {
    sessionStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify({ version: 6, db: initialDb() }))
    expect(restoreDb(sessionStorage)).toBe(false)
    expect(db).toEqual(initialDb())
  })

  it.each(MESSAGE_SCENARIOS)('%s 는 sessionStorage 에서 그대로 복원된다', (scenario) => {
    replaceDb(createScenarioDb(scenario))
    saveDb(sessionStorage)
    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db).toEqual(createScenarioDb(scenario))
  })
})
