import type { MeetingSummary } from '../model/types'
import { findUploadBlockingMeeting } from './uploadBlockingMeeting'

function summary(
  id: string,
  status: MeetingSummary['status'],
  source: MeetingSummary['source'] = 'manual_upload',
): MeetingSummary {
  return {
    id,
    title: id,
    status,
    source,
    startedAt: '2026-09-14T05:00:00Z',
    durationMs: null,
    attendeeCount: 1,
    processedAt: null,
    failedStage: null,
  }
}

it('정리 중인 회의를 찾는다', () => {
  expect(
    findUploadBlockingMeeting([summary('mt_09', 'done'), summary('mt_10', 'processing')])?.id,
  ).toBe('mt_10')
})

it('없으면 null 이다 — 기록 중·완료는 정리 중이 아니다', () => {
  expect(
    findUploadBlockingMeeting([summary('mt_08', 'recording'), summary('mt_09', 'done')]),
  ).toBeNull()
  expect(findUploadBlockingMeeting([])).toBeNull()
})

it('여럿이면 목록 순서(최신순)의 첫 번째다', () => {
  expect(
    findUploadBlockingMeeting([summary('mt_12', 'processing'), summary('mt_11', 'processing')])?.id,
  ).toBe('mt_12')
})

it('채팅 회의는 정리 중이어도 업로드를 막지 않는다 (#450)', () => {
  expect(findUploadBlockingMeeting([summary('mt_12', 'processing', 'chat')])).toBeNull()
  expect(
    findUploadBlockingMeeting([
      summary('mt_12', 'processing', 'chat'),
      summary('mt_11', 'processing'),
    ])?.id,
  ).toBe('mt_11')
})
