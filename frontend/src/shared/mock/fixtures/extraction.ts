import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'

const seeds: [
  string,
  string,
  string | null,
  string,
  string | null,
  string,
  string | null,
  string | null,
  number,
][] = [
  ['it_01', '로그인 API 연동', 'mb_01', '김서연', '2026-09-20', 'auto', 'tk_01', null, 0.9],
  ['it_02', '회원가입 화면', 'mb_02', '박민수', '2026-09-16', 'auto', 'tk_02', null, 0.85],
  ['it_03', 'DB 스키마 정리', 'mb_03', '이재환', '2026-09-22', 'auto', 'tk_03', null, 0.95],
  ['it_04', '알림 문구 검토', null, '민수', null, 'hold', null, 'ap_01', 0.3],
  ['it_05', '테스트 계획 정리', 'mb_02', '박민수', null, 'review', null, 'ap_02', 0.6],
  ['it_06', '배포 문서 보완', null, '지훈', '2026-09-25', 'review', null, 'ap_03', 0.7],
]
const items: ExtractionItemDto[] = seeds.map(
  ([item_id, title, member_id, raw, due, gate, task_id, approval_id, confidence], index) => ({
    item_id,
    task: { title, confidence: 0.95 },
    assignee: {
      raw,
      member_id,
      display_name: member_id ? raw : null,
      confidence: gate === 'auto' || !member_id ? confidence : 0.95,
      needs_check: member_id === null,
    },
    due_date: {
      value: due,
      raw: due === null ? '다음 주 월요일' : due,
      confidence: due === null ? confidence : 0.95,
    },
    confidence,
    gate,
    evidence: {
      quote: `${raw}님이 ${title}을 맡기로 했어요.`,
      speaker: '김서연',
      at_ms: 125000 + index * 10000,
    },
    task_id,
    approval_id,
  }),
)
export const extractionFixtures: ExtractionDto[] = [
  { extraction_id: 'ex_00', meeting_id: 'mt_07', items: [] },
  { extraction_id: 'ex_01', meeting_id: 'mt_09', items },
]
