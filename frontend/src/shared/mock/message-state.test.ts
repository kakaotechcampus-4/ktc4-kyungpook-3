import { MOCK_NOW } from './fixtures/constants'
import { messageReviewFixtures } from './fixtures/message'
import type { MockMessageReview } from './fixtures/message'
import {
  applyPatch,
  approve,
  dismiss,
  isOpen,
  placedAt,
  reminderStatus,
  sendCheck,
  threadDtoOf,
} from './message-state'

const review = (patch: Partial<MockMessageReview> = {}): MockMessageReview => ({
  ...structuredClone(messageReviewFixtures[0]),
  ...patch,
})

const NOW = MOCK_NOW

describe('reminderStatus · placedAt', () => {
  it('마감이 오늘보다 앞인 승인 대기만 만료다', () => {
    expect(reminderStatus(review(), NOW)).toBe('pending')
    expect(reminderStatus(review({ state: 'approved' }), NOW)).toBe('approved')
    expect(reminderStatus(review({ state: 'sent' }), NOW)).toBe('sent')
    expect(reminderStatus(review({ state: 'cancelled' }), NOW)).toBe('cancelled')
    expect(reminderStatus(review({ deadline: '2026-09-18' }), NOW)).toBe('pending')
    expect(reminderStatus(review({ deadline: '2026-09-17' }), NOW)).toBe('expired')
    expect(reminderStatus(review({ deadline: null }), NOW)).toBe('pending')
  })

  it('자리는 단계마다 다르다 — 만료는 예정과 마감 다음 날 중 이른 쪽이다', () => {
    expect(placedAt(review(), NOW)).toBe('2026-09-23T09:00:00+09:00')
    expect(placedAt(review({ state: 'approved' }), NOW)).toBe('2026-09-23T09:00:00+09:00')
    expect(placedAt(review({ state: 'sent', closed_at: NOW }), NOW)).toBe(NOW)
    expect(
      placedAt(review({ state: 'cancelled', closed_at: '2026-09-08T09:00:00+09:00' }), NOW),
    ).toBe('2026-09-08T09:00:00+09:00')
    const expired = review({ deadline: '2026-09-10', scheduled_at: '2026-09-09T18:00:00+09:00' })
    expect(reminderStatus(expired, NOW)).toBe('expired')
    expect(placedAt(expired, NOW)).toBe('2026-09-09T18:00:00+09:00')
    expect(
      placedAt(review({ deadline: '2026-09-10', scheduled_at: '2026-09-12T09:00:00+09:00' }), NOW),
    ).toBe('2026-09-11T00:00:00+09:00')
    expect(placedAt(review({ scheduled_at: null }), NOW)).toBeNull()
  })

  it('열려 있는 것은 승인 대기와 예약뿐이다', () => {
    expect(isOpen(review(), NOW)).toBe(true)
    expect(isOpen(review({ state: 'approved' }), NOW)).toBe(true)
    expect(isOpen(review({ deadline: '2026-09-10' }), NOW)).toBe(false)
    expect(isOpen(review({ state: 'sent' }), NOW)).toBe(false)
    expect(isOpen(review({ state: 'cancelled' }), NOW)).toBe(false)
  })
})

describe('approve · dismiss · applyPatch · sendCheck', () => {
  it('시각이 없으면 지금 보내고, 있으면 승인된 예약으로 남긴다', () => {
    const later = review()
    approve(later, '최진호', NOW)
    expect(later).toMatchObject({ state: 'approved', approved_by: '최진호', closed_at: null })
    const now = review({ scheduled_at: null, send_timing: 'now' })
    approve(now, '최진호', NOW)
    expect(now).toMatchObject({ state: 'sent', approved_by: '최진호', closed_at: NOW })
  })

  it('보내지 않음은 예정 시각과 지금 중 이른 쪽에 취소로 놓는다', () => {
    const future = review()
    dismiss(future, NOW)
    expect(future).toMatchObject({
      state: 'cancelled',
      cancel_reason: 'dismissed',
      closed_at: NOW,
    })
    const past = review({ scheduled_at: '2026-09-08T09:00:00+09:00' })
    dismiss(past, NOW)
    expect(past.closed_at).toBe('2026-09-08T09:00:00+09:00')
  })

  it('승인된 항목을 고치면 다시 승인 대기가 되고 승인자는 빠진다', () => {
    const approved = review({ state: 'approved', approved_by: '최진호' })
    applyPatch(approved, { body: '고친 문구' })
    expect(approved).toMatchObject({ state: 'pending', approved_by: null, body: '고친 문구' })
    const pending = review()
    applyPatch(pending, { send_timing: 'now', scheduled_at: null })
    expect(pending).toMatchObject({ state: 'pending', send_timing: 'now', scheduled_at: null })
  })

  it('발송은 승인 대기만 받고, 지난 예약 시각은 바꾸지 않은 채 거절한다', () => {
    expect(sendCheck(review(), NOW)).toBe('ok')
    expect(sendCheck(review({ scheduled_at: null }), NOW)).toBe('ok')
    expect(sendCheck(review({ state: 'approved' }), NOW)).toBe('gone')
    expect(sendCheck(review({ deadline: '2026-09-10' }), NOW)).toBe('gone')
    const passed = review({ scheduled_at: '2026-09-17T09:00:00+09:00' })
    const before = structuredClone(passed)
    expect(sendCheck(passed, NOW)).toBe('time_passed')
    expect(passed).toEqual(before)
    expect(sendCheck(review({ scheduled_at: NOW }), NOW)).toBe('time_passed')
  })

  it('시각이 없는 재촉 둘은 들어온 순서를 유지한다', () => {
    const messages = threadDtoOf(
      {
        thread_id: 'th_x',
        workspace_id: 'ws_01',
        member_id: null,
        kind: 'direct',
        name: '가',
        team_role: null,
        discord_url: null,
        messages: [],
      },
      [
        review({ review_id: 'rv_a', thread_id: 'th_x', scheduled_at: null, send_timing: 'now' }),
        review({ review_id: 'rv_b', thread_id: 'th_x', scheduled_at: null, send_timing: 'now' }),
      ],
      NOW,
    ).messages
    expect(messages.map(({ message_id }) => message_id)).toEqual(['rv_a', 'rv_b'])
  })
})
