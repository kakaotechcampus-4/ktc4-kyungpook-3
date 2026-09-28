import type { MinutesDto } from '@/shared/types/api/minutes'
import { memberFixtures } from './member'

const minutes: MinutesDto = {
  meeting_id: 'mt_09',
  title: '3주차 정기회의',
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
  transcript: [
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
  ],
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
]
