import type { MinutesDto } from '@/shared/types/api/minutes'
import { memberFixtures } from './member'

type TranscriptLineDto = MinutesDto['transcript'][number]

/** 서버처럼 seq 순으로 번호를 붙인다. 고친 줄은 없다 */
function transcriptLines(
  lines: Omit<TranscriptLineDto, 'seq' | 'edited' | 'original_text'>[],
): TranscriptLineDto[] {
  return lines.map((line, seq) => ({ ...line, seq, edited: false, original_text: null }))
}

const minutes: MinutesDto = {
  meeting_id: 'mt_09',
  title: '3주차 정기회의',
  title_edited: false,
  title_original: null,
  started_at: '2026-09-15T05:00:00Z',
  duration_ms: 2730000,
  source: 'discord',
  attendees: memberFixtures.map((member) => ({
    member_id: member.member_id,
    display_name: member.display_name,
  })),
  summary: {
    overview: '인증 연동과 배포 준비 상황을 공유했다.',
    key_points: ['로그인 API를 연동한다.', 'Notion 권한을 확인한다.'],
    decisions: ['담당자와 마감이 확정된 항목부터 반영한다.'],
  },
  summary_status: 'ready',
  transcript: transcriptLines([
    {
      at_ms: 0,
      speaker_member_id: 'mb_01',
      speaker_display_name: '김서연',
      speaker_fallback: 'seoyeon_01',
      text: '이번 주 진행 상황부터 공유해요.',
    },
    {
      at_ms: 125000,
      speaker_member_id: 'mb_02',
      speaker_display_name: '박민수',
      speaker_fallback: 'minsu',
      text: '회원가입 화면은 제가 맡겠습니다.',
    },
    {
      at_ms: 240000,
      speaker_member_id: 'mb_03',
      speaker_display_name: '이재환',
      speaker_fallback: 'jaehwan',
      text: 'DB 스키마는 Notion 권한이 필요해요.',
    },
    {
      at_ms: 360000,
      speaker_member_id: null,
      speaker_display_name: null,
      speaker_fallback: 'jihun_dev',
      text: '다음 주까지 확인할게요.',
    },
    {
      at_ms: 480000,
      speaker_member_id: 'mb_04',
      speaker_display_name: '정하늘',
      speaker_fallback: 'haneul',
      text: 'STT 정확도 측정을 진행하겠습니다.',
    },
  ]),
  permissions: { can_review: true, can_undo: true },
}
export const minutesFixtures: MinutesDto[] = [
  {
    ...minutes,
    meeting_id: 'mt_07',
    title: '2주차 정기회의',
    started_at: '2026-09-08T05:00:00Z',
    duration_ms: 2700000,
  },
  minutes,
  {
    meeting_id: 'mt_08',
    title: '채팅 2026-09-11',
    title_edited: false,
    title_original: null,
    started_at: '2026-09-11T00:12:00Z',
    duration_ms: 84_480_000,
    source: 'chat',
    attendees: memberFixtures.slice(0, 3).map((member) => ({
      member_id: member.member_id,
      display_name: member.display_name,
    })),
    summary: null,
    summary_status: 'none',
    // 메시지 하나가 한 줄이다. at_ms 는 첫 메시지 기준 오프셋이라 실제 작성 시각은 started_at + at_ms 다
    transcript: transcriptLines([
      {
        at_ms: 0,
        speaker_member_id: 'mb_01',
        speaker_display_name: '김서연',
        speaker_fallback: 'seoyeon_01',
        text: '배포 스크립트 초안 올려 둘게요.',
      },
      {
        at_ms: 7_380_000,
        speaker_member_id: 'mb_02',
        speaker_display_name: '박민수',
        speaker_fallback: 'minsu',
        text: '스테이징 환경 변수도 같이 정리해 주세요.',
      },
      {
        at_ms: 34_080_000,
        speaker_member_id: 'mb_01',
        speaker_display_name: '김서연',
        speaker_fallback: 'seoyeon_01',
        text: '네, 배포 스크립트는 제가 24일까지 마칠게요.',
      },
      {
        at_ms: 84_480_000,
        speaker_member_id: 'mb_03',
        speaker_display_name: '이재환',
        speaker_fallback: 'jaehwan',
        text: '확인했어요. 내일 리뷰할게요.',
      },
    ]),
    permissions: { can_review: true, can_undo: true },
  },
]
