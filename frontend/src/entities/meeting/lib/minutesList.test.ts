import type { MeetingSummary } from '../model/types'
import { latestMinutesId, toMinutesList } from './minutesList'

function meeting(id: string, startedAt: string, status: MeetingSummary['status']): MeetingSummary {
  return {
    id,
    title: id,
    status,
    source: 'discord',
    startedAt,
    durationMs: null,
    attendeeCount: 0,
    processedAt: null,
    failedStage: null,
  }
}

describe('toMinutesList (U5-1, U5-2)', () => {
  it('정리 끝난 회의만 회의록이고 회의 날짜 최신순이다 — 받은 순서가 틀려도 맞춘다', () => {
    const list = toMinutesList([
      meeting('mt_old', '2026-09-01T00:00:00Z', 'done'),
      meeting('mt_new', '2026-09-20T00:00:00Z', 'done'),
      meeting('mt_mid', '2026-09-10T00:00:00Z', 'done'),
    ])

    expect(list.minutes.map(({ id }) => id)).toEqual(['mt_new', 'mt_mid', 'mt_old'])
    expect(list.inProgress).toEqual([])
  })

  it('정리 중·화자 지정 대기·회의 중은 상태 항목으로 따로 두고, 실패 회의는 어디에도 없다', () => {
    const list = toMinutesList([
      meeting('mt_done', '2026-09-01T00:00:00Z', 'done'),
      meeting('mt_processing', '2026-09-03T00:00:00Z', 'processing'),
      meeting('mt_awaiting', '2026-09-02T00:00:00Z', 'awaiting_speakers'),
      meeting('mt_failed', '2026-09-04T00:00:00Z', 'failed'),
      meeting('mt_recording', '2026-09-05T00:00:00Z', 'recording'),
    ])

    expect(list.minutes.map(({ id }) => id)).toEqual(['mt_done'])
    expect(list.inProgress.map(({ id }) => id)).toEqual([
      'mt_recording',
      'mt_processing',
      'mt_awaiting',
    ])
    expect(list.expired).toEqual([])
  })
})

describe('latestMinutesId (D-106)', () => {
  it('가장 최근에 열린 정리 끝난 회의를 고른다 — 더 최근이라도 정리 중인 회의는 아니다', () => {
    expect(
      latestMinutesId([
        meeting('mt_processing', '2026-09-30T00:00:00Z', 'processing'),
        meeting('mt_07', '2026-09-08T05:00:00Z', 'done'),
        meeting('mt_09', '2026-09-15T05:00:00Z', 'done'),
      ]),
    ).toBe('mt_09')
  })

  it('정리 끝난 회의가 없으면 null 이다', () => {
    expect(latestMinutesId([])).toBeNull()
    expect(latestMinutesId([meeting('mt_10', '2026-09-18T00:00:00Z', 'processing')])).toBeNull()
    expect(
      latestMinutesId([meeting('mt_11', '2026-09-19T00:00:00Z', 'awaiting_speakers')]),
    ).toBeNull()
  })
})

it('기한이 지난 수동 업로드(화자 지정·정리 시작)만 만료 이력으로 남기고 완료 회의와 구분한다', () => {
  const expired = {
    ...meeting('mt_expired', '2026-09-30T00:00:00Z', 'failed'),
    source: 'manual_upload' as const,
    failedStage: 'speaker_assignment_expired',
  }
  const list = toMinutesList([
    expired,
    {
      ...expired,
      id: 'mt_unclaimed',
      startedAt: '2026-09-20T00:00:00Z',
      failedStage: 'upload_unclaimed',
    },
    { ...expired, id: 'mt_discord', source: 'discord' },
    { ...expired, id: 'mt_chat', source: 'chat', failedStage: 'upload_unclaimed' },
    { ...expired, id: 'mt_stt', failedStage: 'STT' },
    { ...expired, id: 'mt_diarize', failedStage: 'diarize' },
    { ...expired, id: 'mt_future', failedStage: 'future_stage' },
    { ...expired, id: 'mt_null', failedStage: null },
    { ...expired, id: 'mt_old', startedAt: '2026-09-01T00:00:00Z' },
  ])
  expect(list.expired.map(({ id }) => id)).toEqual(['mt_expired', 'mt_unclaimed', 'mt_old'])
  expect(list.minutes).toEqual([])
  expect(list.inProgress).toEqual([])
  expect(latestMinutesId([expired])).toBeNull()
})
