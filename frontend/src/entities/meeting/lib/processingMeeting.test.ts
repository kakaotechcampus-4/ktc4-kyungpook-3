import type { MeetingSummary } from '../model/types'
import { findProcessingMeeting } from './processingMeeting'

function summary(id: string, status: MeetingSummary['status']): MeetingSummary {
  return {
    id,
    title: id,
    status,
    source: 'manual_upload',
    startedAt: '2026-09-14T05:00:00Z',
    durationMs: null,
    attendeeCount: 1,
    processedAt: null,
  }
}

it('정리 중인 회의를 찾는다', () => {
  expect(
    findProcessingMeeting([summary('mt_09', 'done'), summary('mt_10', 'processing')])?.id,
  ).toBe('mt_10')
})

it('없으면 null 이다 — 기록 중·완료는 정리 중이 아니다', () => {
  expect(
    findProcessingMeeting([summary('mt_08', 'recording'), summary('mt_09', 'done')]),
  ).toBeNull()
  expect(findProcessingMeeting([])).toBeNull()
})

it('여럿이면 목록 순서(최신순)의 첫 번째다', () => {
  expect(
    findProcessingMeeting([summary('mt_12', 'processing'), summary('mt_11', 'processing')])?.id,
  ).toBe('mt_12')
})
