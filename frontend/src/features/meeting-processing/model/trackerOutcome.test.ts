import type { Meeting } from '@/entities/meeting'
import { ApiError, createClientError } from '@/shared/api/errors'
import {
  isAccessLost,
  pollInterval,
  PROCESSING_POLL_INTERVAL_MS,
  trackerOutcome,
} from './trackerOutcome'

const tracked = { workspaceId: 'ws_01', meetingId: 'mt_10' }

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
    progress: { audioMerged: true, transcribed: false, extracted: false },
    ...overrides,
  }
}

const httpError = (status: number, code = 'X') =>
  new ApiError({ code, message: code, details: null }, status)

describe('trackerOutcome', () => {
  it('정리 중·첫 응답 전은 계속 지켜본다', () => {
    expect(trackerOutcome(tracked, meeting(), null)).toBe('processing')
    expect(trackerOutcome(tracked, undefined, null)).toBe('processing')
  })

  it('완료·실패는 끝이다', () => {
    expect(trackerOutcome(tracked, meeting({ status: 'done' }), null)).toBe('done')
    expect(trackerOutcome(tracked, meeting({ status: 'failed' }), null)).toBe('failed')
  })

  it('403·404 는 접근 상실이다 — 받아 둔 상태가 있어도 (U4-3)', () => {
    expect(trackerOutcome(tracked, undefined, httpError(403, 'FORBIDDEN'))).toBe('lost')
    expect(trackerOutcome(tracked, meeting(), httpError(404, 'MEETING_NOT_FOUND'))).toBe('lost')
  })

  it('네트워크·5xx 는 정리 실패가 아니다 — 마지막 상태(없으면 정리 중)를 쓴다 (U4-8)', () => {
    const offline = createClientError('NETWORK_ERROR')
    expect(trackerOutcome(tracked, undefined, offline)).toBe('processing')
    expect(trackerOutcome(tracked, meeting(), offline)).toBe('processing')
    expect(trackerOutcome(tracked, meeting(), httpError(503))).toBe('processing')
    expect(isAccessLost(offline)).toBe(false)
  })

  it('다른 공간의 회의·정리가 시작되지 않은 회의는 지켜볼 대상이 아니다', () => {
    expect(trackerOutcome(tracked, meeting({ workspaceId: 'ws_04' }), null)).toBe('lost')
    expect(trackerOutcome(tracked, meeting({ status: 'recording' }), null)).toBe('lost')
  })
})

describe('pollInterval', () => {
  it('정리 중일 때만 3초다. 끝났거나 볼 수 없으면 멈춘다', () => {
    expect(PROCESSING_POLL_INTERVAL_MS).toBe(3_000)
    expect(pollInterval(tracked, meeting(), null)).toBe(3_000)
    expect(pollInterval(tracked, undefined, createClientError('NETWORK_ERROR'))).toBe(3_000)
    expect(pollInterval(tracked, meeting({ status: 'done' }), null)).toBe(false)
    expect(pollInterval(tracked, meeting({ status: 'failed' }), null)).toBe(false)
    expect(pollInterval(tracked, undefined, httpError(404))).toBe(false)
  })
})
