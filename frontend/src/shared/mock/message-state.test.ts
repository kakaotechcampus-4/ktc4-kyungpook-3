import { MOCK_NOW } from './fixtures/constants'
import {
  botMessage,
  messageBundleFixtures,
  messageThreadFixtures,
  reply,
  schedulePassedBundle,
} from './fixtures/message'
import type { MockBundle, MockMessageThread } from './fixtures/message'
import { approveBundle, cancelBundle, editBundle, threadSummaryOf } from './message-state'

/* 메시지 상태 전이 — 백엔드 services/messages.py 와 같은 규칙인지 본다 */

const bundle = (): MockBundle => structuredClone(messageBundleFixtures[0])

describe('threadSummaryOf', () => {
  const thread = (messages: MockMessageThread['messages']): MockMessageThread => ({
    ...structuredClone(messageThreadFixtures[0]),
    messages,
  })

  it('답장 대기는 팀원의 마지막 답 뒤에 처음 나간 봇 메시지의 시각이고, 시각은 UTC 로 낸다', () => {
    const summary = threadSummaryOf(
      thread([
        botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00'),
        reply('mg_2', 'b', '2026-09-15T10:00:00+09:00'),
        botMessage('mg_3', 'c', '2026-09-16T18:00:00+09:00'),
        botMessage('mg_4', 'd', '2026-09-17T18:00:00+09:00'),
      ]),
    )
    expect(summary.awaiting_reply_since).toBe('2026-09-16T09:00:00.000Z')
    expect(summary.last_message).toMatchObject({ message_id: 'mg_4', sender: 'bot' })
    expect(threadSummaryOf(thread([reply('mg_2', 'b', MOCK_NOW)])).awaiting_reply_since).toBeNull()
    expect(threadSummaryOf(thread([])).last_message).toBeNull()
  })

  it('dm_failed 는 마지막 봇 메시지만 본다', () => {
    const failed = { status: 'failed', reason: 'dm_blocked' } as const
    expect(
      threadSummaryOf(thread([botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00', failed)]))
        .dm_failed,
    ).toBe(true)
    expect(
      threadSummaryOf(
        thread([
          botMessage('mg_1', 'a', '2026-09-15T09:00:00+09:00', failed),
          botMessage('mg_2', 'b', '2026-09-16T09:00:00+09:00'),
          reply('mg_3', 'c', '2026-09-17T09:00:00+09:00'),
        ]),
      ).dm_failed,
    ).toBe(false)
  })
})

describe('approveBundle', () => {
  it('보는 판이 맞으면 승인하고 초안 대기를 닫는다', () => {
    const target = { ...bundle(), draft_status: 'needed' as const }
    expect(approveBundle(target, target.draft_version, MOCK_NOW)).toBeNull()
    expect(target).toMatchObject({ approved: true, approved_at: MOCK_NOW, draft_status: 'done' })
  })

  it('판이 다르면 changed, 시각이 지났으면 time_passed 이고 묶음은 그대로다', () => {
    const target = bundle()
    const before = structuredClone(target)
    expect(approveBundle(target, target.draft_version - 1, MOCK_NOW)).toBe('changed')
    const passed = structuredClone(schedulePassedBundle)
    expect(approveBundle(passed, passed.draft_version, MOCK_NOW)).toBe('time_passed')
    expect(target).toEqual(before)
    expect(passed).toEqual(schedulePassedBundle)
  })

  it('이미 승인했으면 판과 상관없이 그대로 성공이다. 예정이 아니면 not_editable 이다', () => {
    const target = { ...bundle(), approved: true, approved_at: '2026-09-17T09:00:00+09:00' }
    expect(approveBundle(target, 999, MOCK_NOW)).toBeNull()
    expect(target.approved_at).toBe('2026-09-17T09:00:00+09:00')
    expect(approveBundle({ ...bundle(), status: 'cancelled' }, 2, MOCK_NOW)).toBe('not_editable')
  })
})

describe('editBundle · cancelBundle', () => {
  it('문구를 고치면 PM 문구가 되고 판이 오르며 승인은 그대로다', () => {
    const target = { ...bundle(), approved: true, approved_at: MOCK_NOW }
    expect(editBundle(target, { body: '고친 문구' }, MOCK_NOW)).toBeNull()
    expect(target).toMatchObject({
      body: '고친 문구',
      body_source: 'pm',
      draft_version: 3,
      approved: true,
    })
  })

  it('시각만 옮기면 판은 그대로이고, 지난 시각으로는 옮기지 못한다', () => {
    const target = bundle()
    expect(editBundle(target, { scheduled_at: '2026-09-25T14:30:00+09:00' }, MOCK_NOW)).toBeNull()
    expect(target).toMatchObject({ scheduled_at: '2026-09-25T14:30:00+09:00', draft_version: 2 })
    expect(editBundle(target, { scheduled_at: '2026-09-17T09:00:00+09:00' }, MOCK_NOW)).toBe(
      'time_passed',
    )
    // 같은 시각을 문구와 같이 보내는 것은 시각을 고친 것이 아니다
    const passed = structuredClone(schedulePassedBundle)
    expect(
      editBundle(passed, { body: '새 문구', scheduled_at: passed.scheduled_at }, MOCK_NOW),
    ).toBeNull()
  })

  it('보내지 않으면 묶음과 안의 리마인드가 모두 취소되고, 두 번째는 not_editable 이다', () => {
    const target = bundle()
    expect(cancelBundle(target)).toBeNull()
    expect(target.status).toBe('cancelled')
    expect(target.reminders.map(({ status }) => status)).toEqual(['cancelled'])
    expect(cancelBundle(target)).toBe('not_editable')
    expect(editBundle(target, { body: 'x' }, MOCK_NOW)).toBe('not_editable')
  })
})
