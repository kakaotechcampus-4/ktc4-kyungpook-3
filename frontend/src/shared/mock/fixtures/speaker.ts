import type { SpeakerViewDto } from '@/shared/types/api/meeting'

/**
 * AI 가 보낸 화자 라벨. #342 의 모양을 덮는다 — 샘플 3개인 화자, 다른 화자와 겹친 구간 1개인 화자, 0.8초짜리 샘플 1개뿐인 화자.
 * 일부러 말한 시간 순서가 아니다. 조회 handler 가 서버처럼 `total_sec` 내림차순, 같으면 `label` 오름차순으로 준다.
 * 시각은 원본 시작부터의 초이고 모두 `SPEAKER_AUDIO_SECONDS` 안이다
 */
export const speakerLabelFixtures: SpeakerViewDto['speakers'] = [
  { label: 'SPEAKER_02', total_sec: 4.1, samples: [{ start: 70.3, end: 71.1 }] },
  {
    label: 'SPEAKER_00',
    total_sec: 754.2,
    samples: [
      { start: 12, end: 16.5 },
      { start: 48.2, end: 55 },
      { start: 90, end: 98.4 },
    ],
  },
  { label: 'SPEAKER_01', total_sec: 301.7, samples: [{ start: 14, end: 18 }] },
]

export const SPEAKER_AUDIO_SECONDS = 110
