import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type {
  MessageInboxDto,
  MessageReviewDto,
  MessageThreadDto,
} from '@/shared/types/api/message'
import { db, initialDb, replaceDb, resetDb } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { MOCK_DB_STORAGE_KEY, restoreDb, saveDb } from './persistence'
import { applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'

/*
 * M8 메시지의 임시 handler 와 시나리오 (계획 C-7). 경로·모양은 계약이 아니다. 화면 흐름은 app/messagesMsw.test.tsx 가 본다.
 */

const MESSAGE_SCENARIOS = [
  'messages-default',
  'messages-empty',
  'messages-list-error',
  'messages-thread-error',
  'messages-send-fail',
  'messages-member',
  'messages-schedule-passed',
] as const satisfies readonly MockScenario[]

afterEach(() => sessionStorage.clear())

const inbox = (workspaceId = 'ws_01') =>
  fetchDto<MessageInboxDto>(`/workspaces/${workspaceId}/messages`)
const thread = (threadId: string, workspaceId = 'ws_01') =>
  fetchDto<MessageThreadDto>(`/workspaces/${workspaceId}/messages/threads/${threadId}`)
const reviewPath = (reviewId: string, workspaceId = 'ws_01') =>
  `/workspaces/${workspaceId}/messages/reviews/${reviewId}`
const patchReview = (reviewId: string, body: unknown, workspaceId?: string) =>
  fetchDto<MessageReviewDto>(reviewPath(reviewId, workspaceId), jsonRequest('PATCH', body))
const sendReview = (reviewId: string, workspaceId?: string) =>
  fetchDto<{ review_id: string }>(`${reviewPath(reviewId, workspaceId)}/send`, { method: 'POST' })
const dismissReview = (reviewId: string) =>
  fetchDto<{ review_id: string }>(`${reviewPath(reviewId)}/dismiss`, { method: 'POST' })
const snapshot = () => structuredClone({ reviews: db.messageReviews, threads: db.messageThreads })

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
  it('목록은 그 공간의 검토 항목과 대화 요약이다 — 사람별 대화가 최근 순으로 먼저, 채널이 뒤다', async () => {
    const { reviews, threads } = await inbox()
    expect(reviews.map(({ review_id }) => review_id)).toEqual(['rv_01', 'rv_02'])
    expect(threads.map(({ thread_id, kind }) => [thread_id, kind])).toEqual([
      ['th_01', 'direct'],
      ['th_02', 'direct'],
      ['th_03', 'direct'],
      ['th_04', 'direct'],
      ['th_05', 'channel'],
    ])
    expect(threads[0].last_message?.message_id).toBe('mg_03')
    expect(JSON.stringify({ reviews, threads })).not.toContain('workspace_id')
  })

  it('답장 대기는 상대의 마지막 답 뒤에 처음 나간 봇 메시지의 시각이다 — 답한 DM·채널은 null', async () => {
    const { threads } = await inbox()
    expect(
      threads.map(({ thread_id, awaiting_reply_since }) => [thread_id, awaiting_reply_since]),
    ).toEqual([
      ['th_01', '2026-09-16T18:00:00+09:00'],
      ['th_02', null],
      ['th_03', null],
      ['th_04', null],
      ['th_05', null],
    ])
  })

  it('공간마다 따로다 — ws_02 에는 ws_01 의 항목이 없다', async () => {
    const { reviews, threads } = await inbox('ws_02')
    expect(reviews).toEqual([])
    expect(threads.map(({ thread_id }) => thread_id)).toEqual(['th_11'])
  })

  it('대화는 메시지·역할·Discord 주소와 그 대화의 재촉을 시각 순으로 싣는다. 다른 공간의 대화나 없는 대화는 404 다', async () => {
    const detail = await thread('th_01')
    expect(detail).toMatchObject({
      thread_id: 'th_01',
      kind: 'direct',
      name: '이재환',
      team_role: '백엔드',
      awaiting_reply_since: '2026-09-16T18:00:00+09:00',
    })
    expect(
      detail.messages.map(({ message_id, sender, status, at }) => [message_id, sender, status, at]),
    ).toEqual([
      ['mg_01', 'bot', 'sent', '2026-09-15T09:02:00+09:00'],
      ['mg_02', 'member', 'sent', '2026-09-15T09:31:00+09:00'],
      ['mg_03', 'bot', 'sent', '2026-09-16T18:00:00+09:00'],
      ['rv_01', 'bot', 'pending', '2026-09-23T09:00:00+09:00'],
    ])
    expect(detail.messages[2]).toMatchObject({ approved_by: '최진호' })
    expect(detail.messages[3]).toMatchObject({ review_id: 'rv_01' })
    expect((await thread('th_02')).messages.every(({ status }) => status === 'sent')).toBe(true)
    expect((await failure(thread('th_11'))).status).toBe(404)
    expect((await failure(thread('th_99'))).status).toBe(404)
  })

  it('취소됨·만료됨은 확인 목록에 없고, 대화의 기록으로만 남으며 미리보기는 바뀌지 않는다', async () => {
    expect((await inbox()).reviews.map(({ review_id }) => review_id)).toEqual(['rv_01', 'rv_02'])
    expect(
      (await thread('th_03')).messages.find(({ message_id }) => message_id === 'rv_03'),
    ).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'responded',
      at: '2026-09-08T09:00:00+09:00',
    })
    expect(
      (await thread('th_04')).messages.find(({ message_id }) => message_id === 'rv_04'),
    ).toMatchObject({
      status: 'expired',
      at: '2026-09-09T18:00:00+09:00',
    })
    const { threads } = await inbox()
    expect(threads.find(({ thread_id }) => thread_id === 'th_03')?.last_message?.message_id).toBe(
      'mg_07',
    )
    expect(threads.find(({ thread_id }) => thread_id === 'th_04')?.last_message?.message_id).toBe(
      'mg_09',
    )
  })

  it('소속이 아닌 공간은 403 이다', async () => {
    expect((await failure(inbox('ws_09'))).status).toBe(403)
    expect((await failure(sendReview('rv_01', 'ws_09'))).status).toBe(403)
  })

  it('조회는 db 를 바꾸지 않는다', async () => {
    const before = snapshot()
    await inbox()
    await thread('th_01')
    expect(snapshot()).toEqual(before)
  })
})

describe('보내기 전 확인 항목의 행동 handler — 성공할 때만 db 를 바꾼다 (D-137)', () => {
  it('발송: 정해 둔 시각이 MOCK_NOW 뒤면 예약으로 남고 새 메시지는 만들지 않는다', async () => {
    expect(await sendReview('rv_01')).toEqual({ review_id: 'rv_01' })
    expect(db.messageReviews.find(({ review_id }) => review_id === 'rv_01')).toMatchObject({
      state: 'approved',
      approved_by: '최진호',
      scheduled_at: '2026-09-23T09:00:00+09:00',
    })
    expect(
      db.messageThreads
        .find(({ thread_id }) => thread_id === 'th_01')
        ?.messages.map(({ message_id }) => message_id),
    ).toEqual(['mg_01', 'mg_02', 'mg_03'])
    expect((await inbox()).reviews.map(({ review_id }) => review_id)).toEqual(['rv_01', 'rv_02'])
    expect((await inbox()).reviews[0]).toMatchObject({ status: 'scheduled', approved_by: '최진호' })
    expect((await thread('th_01')).messages.at(-1)).toMatchObject({
      message_id: 'rv_01',
      status: 'scheduled',
      at: '2026-09-23T09:00:00+09:00',
    })
    // 예약은 아직 나가지 않았다 — 목록의 마지막 메시지와 답장 대기는 그대로다
    const summary = (await inbox()).threads.find(({ thread_id }) => thread_id === 'th_01')
    expect(summary?.last_message?.message_id).toBe('mg_03')
    expect(summary?.awaiting_reply_since).toBe('2026-09-16T18:00:00+09:00')
  })

  it('발송: 지금 바로면 MOCK_NOW 에 나간 재촉이고 그 대화는 답장을 기다린다', async () => {
    expect(await sendReview('rv_02')).toEqual({ review_id: 'rv_02' })
    expect((await thread('th_03')).messages.at(-1)).toMatchObject({
      message_id: 'rv_02',
      status: 'sent',
      at: MOCK_NOW,
    })
    expect((await thread('th_03')).awaiting_reply_since).toBe(MOCK_NOW)
    expect((await inbox()).threads[0].thread_id).toBe('th_03')
    expect((await inbox()).reviews.map(({ review_id }) => review_id)).toEqual(['rv_01'])
  })

  it('보내지 않음: 취소된 기록으로 남고 확인 목록에서는 빠진다', async () => {
    expect(await dismissReview('rv_01')).toEqual({ review_id: 'rv_01' })
    expect(db.messageReviews.find(({ review_id }) => review_id === 'rv_01')).toMatchObject({
      state: 'cancelled',
      cancel_reason: 'dismissed',
      closed_at: MOCK_NOW,
    })
    expect((await inbox()).reviews.map(({ review_id }) => review_id)).toEqual(['rv_02'])
    expect(
      (await thread('th_01')).messages.find(({ message_id }) => message_id === 'rv_01'),
    ).toMatchObject({
      status: 'cancelled',
      at: MOCK_NOW,
      cancel_reason: 'dismissed',
    })
  })

  it('고쳐 쓰기: 앞뒤 공백을 지운 문구를 저장한다. 빈 문구·너무 긴 문구는 400 이고 db 는 그대로다', async () => {
    expect((await patchReview('rv_01', { body: '  고친 문구예요 🙂  ' })).body).toBe(
      '고친 문구예요 🙂',
    )
    const before = snapshot()
    expect((await failure(patchReview('rv_01', { body: '   ' }))).status).toBe(400)
    expect((await failure(patchReview('rv_01', { body: '가'.repeat(2001) }))).status).toBe(400)
    expect((await failure(patchReview('rv_01', {}))).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it('발송 시점: 지금 바로·마감 하루 전·직접 정한 시각으로 바꾼다', async () => {
    expect(await patchReview('rv_01', { send_timing: 'now' })).toMatchObject({
      send_timing: 'now',
      scheduled_at: null,
    })
    expect(await patchReview('rv_01', { send_timing: 'day_before_deadline' })).toMatchObject({
      send_timing: 'day_before_deadline',
      scheduled_at: '2026-09-23T09:00:00+09:00',
    })
    expect(
      await patchReview('rv_01', {
        send_timing: 'custom',
        scheduled_at: '2026-09-25T14:30:00+09:00',
      }),
    ).toMatchObject({ send_timing: 'custom', scheduled_at: '2026-09-25T14:30:00+09:00' })
  })

  it.each([
    ['마감이 없는 항목의 마감 하루 전', 'rv_02', { send_timing: 'day_before_deadline' }],
    ['지난 시각', 'rv_01', { send_timing: 'custom', scheduled_at: '2026-09-18T08:59:00+09:00' }],
    ['시각 없는 직접 정하기', 'rv_01', { send_timing: 'custom' }],
    ['모르는 시점', 'rv_01', { send_timing: 'later' }],
  ])('발송 시점: %s 은 400 이고 db 는 그대로다', async (_name, reviewId, body) => {
    const before = snapshot()
    expect((await failure(patchReview(reviewId, body))).status).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it('없는 항목은 404 다 — 이미 처리한 항목을 다시 보내도 같다. PM 이 아닌 공간은 403 이다', async () => {
    await sendReview('rv_01')
    expect((await failure(sendReview('rv_01'))).status).toBe(404)
    expect((await failure(dismissReview('rv_99'))).status).toBe(404)
    const before = snapshot()
    const denied = await failure(patchReview('rv_02', { body: '가' }, 'ws_02'))
    expect(denied.status).toBe(403)
    expect(denied.message).toBe('PM만 할 수 있는 작업입니다.')
    expect(snapshot()).toEqual(before)
  })
})

describe('메시지 시나리오', () => {
  it('messages-empty: ws_01 의 검토·대화가 모두 없다', async () => {
    applyScenario('messages-empty')
    expect(await inbox()).toEqual({ reviews: [], threads: [] })
  })

  it('messages-list-error: 목록만 5xx 이고 대화는 받는다', async () => {
    applyScenario('messages-list-error')
    expect((await failure(inbox())).status).toBe(500)
    expect((await thread('th_01')).thread_id).toBe('th_01')
  })

  it('messages-thread-error: 목록은 받고 th_01 만 5xx 다', async () => {
    applyScenario('messages-thread-error')
    expect((await inbox()).threads).toHaveLength(5)
    expect((await failure(thread('th_01'))).status).toBe(500)
    expect((await thread('th_02')).thread_id).toBe('th_02')
  })

  it('messages-member: 조회는 되고 발송·보내지 않음·고쳐 쓰기는 403 이며 db 는 그대로다', async () => {
    applyScenario('messages-member')
    expect((await inbox()).reviews).toHaveLength(2)
    const before = snapshot()
    for (const request of [
      sendReview('rv_01'),
      dismissReview('rv_01'),
      patchReview('rv_01', { body: '고친 문구' }),
      patchReview('rv_01', { send_timing: 'now' }),
    ]) {
      const error = await failure(request)
      expect(error.status).toBe(403)
      expect(error.message).toBe('PM만 할 수 있는 작업입니다.')
    }
    expect(snapshot()).toEqual(before)
  })

  it('messages-schedule-passed: 지난 예약 발송은 409 이고 마감 하루 전으로 되돌리기는 400 이다', async () => {
    applyScenario('messages-schedule-passed')
    const before = snapshot()
    const denied = await failure(sendReview('rv_06'))
    expect(denied.status).toBe(409)
    expect(denied.code).toBe('MESSAGE_SCHEDULE_PASSED')
    expect(denied.message).toBe('예정 시각이 지났습니다. 발송 시각을 다시 골라 주세요.')
    expect((await inbox()).reviews.map(({ review_id }) => review_id)).toEqual([
      'rv_01',
      'rv_02',
      'rv_06',
    ])
    expect(
      (await failure(patchReview('rv_06', { send_timing: 'day_before_deadline' }))).status,
    ).toBe(400)
    expect(snapshot()).toEqual(before)
  })

  it('messages-send-fail: 조회는 되고 행동은 모두 5xx 이며 db 는 그대로다', async () => {
    applyScenario('messages-send-fail')
    expect((await inbox()).reviews).toHaveLength(2)
    const before = snapshot()
    expect((await failure(sendReview('rv_01'))).status).toBe(500)
    expect((await failure(dismissReview('rv_01'))).status).toBe(500)
    expect((await failure(patchReview('rv_01', { body: '고친 문구' }))).status).toBe(500)
    expect((await failure(patchReview('rv_01', { send_timing: 'now' }))).status).toBe(500)
    expect(snapshot()).toEqual(before)
  })

  it('저장 버전 4 는 버린다', () => {
    sessionStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify({ version: 4, db: initialDb() }))
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
