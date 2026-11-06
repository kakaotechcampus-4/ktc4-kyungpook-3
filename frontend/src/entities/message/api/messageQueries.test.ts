import { http } from 'msw'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import type { BundleDto, ReminderDto } from '@/shared/types/api/message'
import { createReminder, requestMessageAction } from './messageQueries'

/* 행동 종류마다 서버가 받는 경로·본문과, 응답을 읽은 결과. 서버 상태 규칙은 shared/mock 의 테스트가 본다 */

const BASE = '/api/v1/workspaces/ws_01/messages'

const reminderDto = (patch: Partial<ReminderDto> = {}): ReminderDto => ({
  reminder_id: 'rm_02',
  bundle_id: 'bd_02',
  task_id: 'tk_04',
  task_title: '퍼블리싱',
  due_date: null,
  note: '시안 2차 반영분까지',
  status: 'scheduled',
  kind: 'nudge',
  origin: 'pm',
  created_at: '2026-09-15T00:00:00Z',
  ...patch,
})

const bundleDto = (patch: Partial<BundleDto> = {}): BundleDto => ({
  bundle_id: 'bd_02',
  thread_id: 'th_03',
  member_id: 'mb_04',
  recipient_name: '정하늘',
  scheduled_at: '2026-09-25T05:00:00Z',
  status: 'scheduled',
  approved: false,
  approved_at: null,
  body: '하늘님, 진행 상황 알려 주세요',
  body_source: 'rule',
  draft_status: 'needed',
  draft_version: 3,
  reminders: [reminderDto()],
  ...patch,
})

interface Received {
  method: string
  path: string
  body: unknown
}

/** 그 경로가 받은 요청을 적고 data 로 답한다 */
function answer(method: 'post' | 'patch', path: string, data: unknown): Received[] {
  const received: Received[] = []
  server.use(
    http[method](`${BASE}/${path}`, async ({ request }) => {
      const text = await request.text()
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      })
      return ok(data)
    }),
  )
  return received
}

describe('태스크 빼기', () => {
  it('리마인드 취소 경로로 본문 없이 보내고, 남은 태스크가 있으면 done 이다', async () => {
    const received = answer('post', 'reminders/:id/cancel', {
      reminder: reminderDto({ status: 'cancelled' }),
      bundle: bundleDto(),
    })
    await expect(
      requestMessageAction('ws_01', { kind: 'removeTask', bundleId: 'bd_02', reminderId: 'rm_02' }),
    ).resolves.toEqual({ kind: 'done' })
    expect(received).toEqual([
      { method: 'POST', path: `${BASE}/reminders/rm_02/cancel`, body: undefined },
    ])
  })

  it('마지막 태스크라 서버가 묶음을 취소했으면 closed 다', async () => {
    answer('post', 'reminders/:id/cancel', {
      reminder: reminderDto({ status: 'cancelled' }),
      bundle: bundleDto({ status: 'cancelled', reminders: [reminderDto({ status: 'cancelled' })] }),
    })
    await expect(
      requestMessageAction('ws_01', { kind: 'removeTask', bundleId: 'bd_02', reminderId: 'rm_02' }),
    ).resolves.toEqual({ kind: 'closed' })
  })
})

describe('메모 고치기', () => {
  it('리마인드 고치기 경로로 메모만 보낸다. 지우면 null 을 보낸다', async () => {
    const received = answer('patch', 'reminders/:id', {
      reminder: reminderDto(),
      bundle: bundleDto(),
    })
    await expect(
      requestMessageAction('ws_01', {
        kind: 'editNote',
        bundleId: 'bd_02',
        reminderId: 'rm_02',
        note: '시안 3차까지',
      }),
    ).resolves.toEqual({ kind: 'done' })
    await requestMessageAction('ws_01', {
      kind: 'editNote',
      bundleId: 'bd_02',
      reminderId: 'rm_02',
      note: null,
    })
    expect(received).toEqual([
      { method: 'PATCH', path: `${BASE}/reminders/rm_02`, body: { note: '시안 3차까지' } },
      { method: 'PATCH', path: `${BASE}/reminders/rm_02`, body: { note: null } },
    ])
  })
})

describe('보낼 시각 옮기기', () => {
  it('서버가 다른 묶음을 돌려주면 그 묶음으로 합쳐진 것이고, 같은 묶음이면 done 이다', async () => {
    answer('patch', 'bundles/:id', bundleDto({ bundle_id: 'bd_01' }))
    await expect(
      requestMessageAction('ws_01', {
        kind: 'schedule',
        bundleId: 'bd_02',
        scheduledAt: '2026-09-23T09:00:00+09:00',
      }),
    ).resolves.toMatchObject({ kind: 'merged', into: { id: 'bd_01' } })

    answer('patch', 'bundles/:id', bundleDto())
    await expect(
      requestMessageAction('ws_01', {
        kind: 'schedule',
        bundleId: 'bd_02',
        scheduledAt: '2026-09-26T09:00:00+09:00',
      }),
    ).resolves.toEqual({ kind: 'done' })
  })
})

describe('재촉 만들기', () => {
  it('팀원·태스크·시각·메모를 서버 칸 이름으로 보내고, 만든 재촉과 그것이 든 묶음을 돌려준다', async () => {
    const received = answer('post', 'reminders', {
      reminder: reminderDto({ reminder_id: 'rm_09' }),
      bundle: bundleDto(),
    })
    const created = await createReminder('ws_01', {
      memberId: 'mb_04',
      taskId: 'tk_04',
      scheduledAt: '2026-09-25T14:00:00+09:00',
      note: null,
    })
    expect(received).toEqual([
      {
        method: 'POST',
        path: `${BASE}/reminders`,
        body: {
          member_id: 'mb_04',
          task_id: 'tk_04',
          scheduled_at: '2026-09-25T14:00:00+09:00',
          note: null,
        },
      },
    ])
    expect(created.reminderId).toBe('rm_09')
    expect(created.bundle).toMatchObject({ id: 'bd_02', recipientName: '정하늘' })
    expect(created.bundle.tasks.map(({ reminderId }) => reminderId)).toEqual(['rm_02'])
  })
})
