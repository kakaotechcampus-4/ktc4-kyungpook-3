import { isAccessLost } from '@/entities/meeting'
import type { Meeting } from '@/entities/meeting'
import { ApiError, createClientError, createWorkspaceMismatchError } from '@/shared/api/errors'
import { createInvalidResponseError } from '@/shared/api/parseResponse'
import {
  AWAITING_SPEAKERS_POLL_INTERVAL_MS,
  pollInterval,
  PROCESSING_POLL_INTERVAL_MS,
  trackerOutcome,
} from './trackerOutcome'

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mt_10',
    workspaceId: 'ws_01',
    title: '3주차 정기회의',
    status: 'processing',
    startedAt: '2026-09-14T05:00:00.000Z',
    endedAt: null,
    extractionId: null,
    failedStage: null,
    deletionAvailable: false,
    progress: { audioMerged: true, transcribed: false, extracted: false },
    processing: null,
    ...overrides,
  }
}

const httpError = (status: number, code = 'X') =>
  new ApiError({ code, message: code, details: null }, status)

describe('trackerOutcome', () => {
  it('정리 중·첫 응답 전은 계속 지켜본다', () => {
    expect(trackerOutcome(meeting(), null)).toBe('processing')
    expect(trackerOutcome(undefined, null)).toBe('processing')
  })

  it('완료·실패는 끝이다', () => {
    expect(trackerOutcome(meeting({ status: 'done' }), null)).toBe('done')
    expect(trackerOutcome(meeting({ status: 'failed' }), null)).toBe('failed')
  })

  it('403·404 는 접근 상실이다 — 받아 둔 상태가 있어도 (U4-3)', () => {
    expect(trackerOutcome(undefined, httpError(403, 'FORBIDDEN'))).toBe('lost')
    expect(trackerOutcome(meeting(), httpError(404, 'MEETING_NOT_FOUND'))).toBe('lost')
  })

  it('네트워크·5xx 는 정리 실패가 아니다 — 마지막 상태(없으면 정리 중)를 쓴다 (U4-8)', () => {
    const offline = createClientError('NETWORK_ERROR')
    expect(trackerOutcome(undefined, offline)).toBe('processing')
    expect(trackerOutcome(meeting(), offline)).toBe('processing')
    expect(trackerOutcome(meeting(), httpError(503))).toBe('processing')
    expect(isAccessLost(offline)).toBe(false)
  })

  it('화자 지정 대기는 접근 상실이 아니라 지켜볼 진행이다 (#256)', () => {
    expect(trackerOutcome(meeting({ status: 'awaiting_speakers' }), null)).toBe('awaiting_speakers')
    expect(
      trackerOutcome(meeting({ status: 'awaiting_speakers' }), createClientError('NETWORK_ERROR')),
    ).toBe('awaiting_speakers')
  })

  it('정리가 시작되지 않은 회의는 지켜볼 대상이 아니다', () => {
    expect(trackerOutcome(meeting({ status: 'recording' }), null)).toBe('lost')
  })

  it('상세가 다른 공간의 회의라고 답하면 받아 둔 상태가 없을 때만 그만 본다 (#349)', () => {
    const mismatch = createWorkspaceMismatchError('ws_01', 'ws_04')
    expect(isAccessLost(mismatch)).toBe(false)
    expect(trackerOutcome(undefined, mismatch)).toBe('lost')
    expect(trackerOutcome(meeting(), mismatch)).toBe('processing')
    expect(trackerOutcome(meeting({ status: 'awaiting_speakers' }), mismatch)).toBe(
      'awaiting_speakers',
    )
    expect(pollInterval(undefined, mismatch)).toBe(false)
    expect(pollInterval(meeting(), mismatch)).toBe(PROCESSING_POLL_INTERVAL_MS)
  })
})

describe('pollInterval', () => {
  it('정리 중일 때만 3초다. 끝났거나 볼 수 없으면 멈춘다', () => {
    expect(PROCESSING_POLL_INTERVAL_MS).toBe(3_000)
    expect(pollInterval(meeting(), null)).toBe(3_000)
    expect(pollInterval(undefined, createClientError('NETWORK_ERROR'))).toBe(3_000)
    expect(pollInterval(meeting({ status: 'done' }), null)).toBe(false)
    expect(pollInterval(meeting({ status: 'failed' }), null)).toBe(false)
    expect(pollInterval(undefined, httpError(404))).toBe(false)
  })

  it('화자 지정 대기는 멈추지 않고 30초마다 묻는다', () => {
    expect(AWAITING_SPEAKERS_POLL_INTERVAL_MS).toBe(30_000)
    expect(pollInterval(meeting({ status: 'awaiting_speakers' }), null)).toBe(30_000)
  })
})

describe('읽지 못한 상세 응답 (#348)', () => {
  const invalid = createInvalidResponseError('meeting', 'status')

  it('받아 둔 상세가 있든 없든 invalid 다. 정리 중으로 보지 않고 끝내지도 않는다', () => {
    expect(trackerOutcome(undefined, invalid)).toBe('invalid')
    expect(trackerOutcome(meeting(), invalid)).toBe('invalid')
    expect(trackerOutcome(meeting({ status: 'awaiting_speakers' }), invalid)).toBe('invalid')
  })

  it('polling 과 포커스·연결 복귀 재조회를 모두 멈춘다', () => {
    expect(pollInterval(undefined, invalid)).toBe(false)
    expect(pollInterval(meeting(), invalid)).toBe(false)
  })
})
