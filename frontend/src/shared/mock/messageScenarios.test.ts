import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type {
  BundleDto,
  InboxDto,
  MessageDto,
  ReminderWithBundleDto,
  ThreadDetailDto,
} from '@/shared/types/api/message'
import { db, initialDb, replaceDb, resetDb } from './db'
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
  'messages-schedule-passed',
  'messages-merge',
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
      },
      awaiting_reply_since: '2026-09-16T09:00:00.000Z',
      dm_failed: false,
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

  it('PM 도 남의 대화에는 답장할 수 없다', async () => {
    const before = snapshot()
    const error = await failure(replyTo('th_01', 'PM 답장'))
    expect([error.status, error.code]).toEqual([403, 'FORBIDDEN'])
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
