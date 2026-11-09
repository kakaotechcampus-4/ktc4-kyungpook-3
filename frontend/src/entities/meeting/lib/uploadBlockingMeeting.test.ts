import type { MeetingSummary } from '../model/types'
import { findAcceptedUpload, findUploadBlockingMeeting } from './uploadBlockingMeeting'

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

describe('결과를 모르는 업로드 찾기 (#348 리뷰)', () => {
  const sent = { title: '회의', startedAt: '2026-09-14T05:00:00.000Z' }
  const named = (
    id: string,
    status: MeetingSummary['status'],
    source?: MeetingSummary['source'],
  ) => ({
    ...summary(id, status, source),
    title: '회의',
  })

  it('올리기 전에 없던 같은 제목·시각의 직접 올린 회의를 상태와 상관없이 찾는다', () => {
    for (const status of ['processing', 'awaiting_speakers', 'done'] as const)
      expect(findAcceptedUpload([named('mt_30', status)], sent, new Set())).toEqual({
        kind: 'found',
        meeting: named('mt_30', status),
      })
  })

  it('올리기 전에 있던 회의·다른 제목·다른 시각·채팅 회의는 이 업로드가 아니다', () => {
    expect(
      findAcceptedUpload(
        [
          named('mt_09', 'done'),
          { ...named('mt_31', 'processing'), title: '다른 회의' },
          { ...named('mt_32', 'processing'), startedAt: '2026-09-14T06:00:00Z' },
          named('mt_33', 'processing', 'chat'),
        ],
        sent,
        new Set(['mt_09']),
      ),
    ).toEqual({ kind: 'none' })
  })

  it('같아 보이는 새 회의가 여럿이면 어느 것인지 정하지 않는다', () => {
    expect(
      findAcceptedUpload([named('mt_30', 'processing'), named('mt_31', 'done')], sent, new Set()),
    ).toEqual({ kind: 'ambiguous' })
  })
})
