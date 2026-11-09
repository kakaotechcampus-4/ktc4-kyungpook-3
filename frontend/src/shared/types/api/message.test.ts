import { ApiError } from '@/shared/api/errors'
import { applyScenario } from '@/shared/mock/scenarios'
import type { MockScenario } from '@/shared/mock/scenarios'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import {
  bundleSchema,
  createdReminderSchema,
  inboxSchema,
  messageSchema,
  reminderWithBundleSchema,
  threadDetailSchema,
  threadSummarySchema,
  threadUpdatedSignalSchema,
} from './message'
import { replyAttributionListSchema, replyAttributionSchema } from './reply'

const reminder = {
  reminder_id: 'rm_01',
  task_id: 'tk_01',
  task_title: 'API 명세서',
  due_date: '2026-09-24',
  note: null,
  reason: '마감이 다음 주예요',
  evidence: { kind: 'reply', at: '2026-09-16T00:00:00Z', message_id: 'mg_02' },
}
const bundle = {
  bundle_id: 'bd_01',
  thread_id: 'th_01',
  member_id: 'mb_03',
  recipient_name: '이재환',
  scheduled_at: '2026-09-18T00:00:00Z',
  status: 'scheduled',
  approved: false,
  approved_at: null,
  body: '진행 상황 알려 주세요',
  body_source: 'ai',
  draft_status: 'done',
  draft_version: 2,
  summary: 'API 명세서 진행 상황 확인',
  reminders: [reminder],
}
const bot = {
  message_id: 'mg_01',
  sender: 'bot',
  body: '진행 상황 알려 주세요',
  created_at: '2026-09-16T00:00:00Z',
  reply_channel: null,
  dm_status: 'delivered',
  dm_failure_reason: null,
  author_member_id: null,
  author_name: null,
}
const summary = {
  thread_id: 'th_01',
  member_id: 'mb_03',
  name: '이재환',
  last_message: { ...bot },
  awaiting_reply_since: null,
  dm_failed: false,
  web_reply_available: true,
}

const pathOf = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues[0]?.path

describe('메시지 스키마', () => {
  it.each([
    ['모르는 보낸 쪽', { sender: 'admin' }, ['sender']],
    ['모르는 DM 상태', { dm_status: 'bounced' }, ['dm_status']],
    ['DM 상태가 없는 봇 메시지', { dm_status: null }, ['dm_status']],
    ['DM 상태가 없는 PM 메시지', { sender: 'pm', dm_status: null }, ['dm_status']],
    ['답장 경로가 없는 팀원 메시지', { sender: 'member', dm_status: null }, ['reply_channel']],
  ])('%s 는 읽지 않는다', (_, patch, path) => {
    expect(pathOf(messageSchema.safeParse({ ...bot, ...patch }))).toEqual(path)
  })

  it('모르는 DM 실패 이유·답장 경로는 거절하지 않는다. mapper 가 보수 폴백으로 읽는다', () => {
    expect(
      messageSchema.safeParse({ ...bot, dm_status: 'failed', dm_failure_reason: 'rate_limited' })
        .success,
    ).toBe(true)
    expect(
      messageSchema.safeParse({ ...bot, sender: 'member', dm_status: null, reply_channel: 'slack' })
        .success,
    ).toBe(true)
  })

  it('작성자 칸이 빠진 옛 응답도 읽는다 (#519)', () => {
    const legacy: Partial<typeof bot> = { ...bot, sender: 'pm', dm_status: 'pending' }
    delete legacy.author_member_id
    delete legacy.author_name
    expect(messageSchema.safeParse(legacy).success).toBe(true)
  })
})

describe('묶음 스키마', () => {
  it.each([
    ['모르는 상태', { status: 'paused' }, ['status']],
    ['승인 시각이 없는 승인한 예정 묶음', { approved: true }, ['approved_at']],
    ['정수가 아닌 문구 판', { draft_version: 2.5 }, ['draft_version']],
    ['문구 누락', { body: undefined }, ['body']],
  ])('%s 는 읽지 않는다', (_, patch, path) => {
    expect(pathOf(bundleSchema.safeParse({ ...bundle, ...patch }))).toEqual(path)
  })

  it('모르는 문구 출처·초안 상태·근거 종류는 거절하지 않는다', () => {
    expect(
      bundleSchema.safeParse({
        ...bundle,
        body_source: 'template',
        draft_status: 'queued',
        reminders: [{ ...reminder, evidence: { ...reminder.evidence, kind: 'meeting' } }],
      }).success,
    ).toBe(true)
  })

  it('요약·이유·근거가 빠진 옛 응답(#418 전)도 읽는다', () => {
    const oldReminder: Partial<typeof reminder> = { ...reminder }
    delete oldReminder.reason
    delete oldReminder.evidence
    const legacy: Partial<typeof bundle> = {
      ...bundle,
      reminders: [oldReminder as typeof reminder],
    }
    delete legacy.summary
    expect(bundleSchema.safeParse(legacy).success).toBe(true)
  })

  it('막 만든 재촉의 묶음이 예정이 아니면 읽지 않는다', () => {
    const created = { reminder, bundle: { ...bundle, status: 'cancelled' } }
    expect(reminderWithBundleSchema.safeParse(created).success).toBe(true)
    expect(pathOf(createdReminderSchema.safeParse(created))).toEqual(['bundle', 'status'])
  })
})

describe('대화 요약·목록', () => {
  it('웹 답장 여부가 빠진 옛 응답도 읽는다 (#525)', () => {
    const legacy: Partial<typeof summary> = { ...summary }
    delete legacy.web_reply_available
    expect(threadSummarySchema.safeParse(legacy).success).toBe(true)
  })

  it('목록의 대화 한 건만 틀려도 전체를 읽지 않는다', () => {
    const result = inboxSchema.safeParse({
      threads: [summary, { ...summary, last_message: { ...bot, sender: 'system' } }],
      bundles: null,
    })
    expect(pathOf(result)).toEqual(['threads', 1, 'last_message', 'sender'])
  })

  it('대화의 메시지 한 건만 틀려도 대화 전체를 읽지 않는다', () => {
    const result = threadDetailSchema.safeParse({
      thread: summary,
      messages: [bot, { ...bot, message_id: 'mg_09', dm_status: 'bounced' }],
      bundles: [bundle],
    })
    expect(pathOf(result)).toEqual(['messages', 1, 'dm_status'])
  })
})

describe('답장 고르기', () => {
  it('모르는 상태는 읽지 않는다', () => {
    expect(
      replyAttributionSchema.safeParse({ message_id: 'mg_05', status: 'skipped', task: null })
        .success,
    ).toBe(false)
  })
})

describe('대화 신호 웹소켓 프레임 (#558)', () => {
  it('thread_updated 와 대화 ID 만 신호다', () => {
    expect(
      threadUpdatedSignalSchema.safeParse({ type: 'thread_updated', thread_id: 'th_01' }).success,
    ).toBe(true)
    expect(threadUpdatedSignalSchema.safeParse({ type: 'thread_updated' }).success).toBe(false)
    expect(
      threadUpdatedSignalSchema.safeParse({ type: 'bundle_updated', thread_id: 'th_01' }).success,
    ).toBe(false)
  })
})

/** 이 공간의 목록·대화를 화면이 부르는 순서로 받아 스키마로 읽는다. 읽은 대화 수와 고르기 목록 수를 돌려준다 */
async function readMessages(): Promise<{ threads: number; attributions: number }> {
  const inbox = inboxSchema.parse(await fetchDto('/workspaces/ws_01/messages'))
  let attributions = 0
  for (const { thread_id } of inbox.threads) {
    threadDetailSchema.parse(await fetchDto(`/workspaces/ws_01/messages/threads/${thread_id}`))
    if (inbox.bundles === null) continue
    replyAttributionListSchema.parse(
      await fetchDto(`/workspaces/ws_01/messages/threads/${thread_id}/attributions`),
    )
    attributions += 1
  }
  return { threads: inbox.threads.length, attributions }
}

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  const scenarios: (MockScenario | null)[] = [
    null,
    'messages-default',
    'messages-empty',
    'messages-member',
    'messages-member-push',
    'messages-pm-self',
    'messages-schedule-passed',
    'messages-merge',
    'messages-long-content',
    'messages-pm-thread',
    'reply-judgment',
    'reply-judgment-member',
  ]
  const total = { threads: 0, attributions: 0 }

  it.each(scenarios)('%s 상태의 목록·대화·답장 고르기', async (scenario) => {
    if (scenario !== null) applyScenario(scenario)
    const read = await readMessages()
    total.threads += read.threads
    total.attributions += read.attributions
  })

  it('위 상태들에서 대화와 답장 고르기 목록을 실제로 읽었다', () => {
    expect(total.threads).toBeGreaterThan(0)
    expect(total.attributions).toBeGreaterThan(0)
  })

  it('쓰기 응답 — 대화 열기·시각 옮기기·재촉 만들기·고치기·빼기', async () => {
    applyScenario('messages-default')
    const base = '/workspaces/ws_01/messages'
    threadSummarySchema.parse(
      await fetchDto(`${base}/threads`, jsonRequest('POST', { member_id: 'mb_03' })),
    )
    bundleSchema.parse(
      await fetchDto(
        `${base}/bundles/bd_01`,
        jsonRequest('PATCH', { scheduled_at: '2026-09-21T09:00:00+09:00' }),
      ),
    )
    const created = createdReminderSchema.parse(
      await fetchDto(
        `${base}/reminders`,
        jsonRequest('POST', {
          member_id: 'mb_02',
          task_id: 'tk_02',
          scheduled_at: '2026-09-21T09:00:00+09:00',
        }),
      ),
    )
    const id = created.reminder.reminder_id
    reminderWithBundleSchema.parse(
      await fetchDto(`${base}/reminders/${id}`, jsonRequest('PATCH', { note: '메모' })),
    )
    reminderWithBundleSchema.parse(
      await fetchDto(`${base}/reminders/${id}/cancel`, { method: 'POST' }),
    )
  })

  it('목록 실패 상태는 응답이 아니라 오류다 — 스키마 검사를 건너뛴 것이 아니다', async () => {
    applyScenario('messages-list-error')
    await expect(fetchDto('/workspaces/ws_01/messages')).rejects.toBeInstanceOf(ApiError)
  })
})
