import type { MockExtraction, MockExtractionItem } from '../aliasLearning'

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
const items: MockExtractionItem[] = seeds.map(
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
      speaker: '1123',
      at_ms: 125000 + index * 10000,
      speaker_member_id: 'mb_01',
    },
    reverted_at: null,
    task_id,
    approval_id,
    // 조회 handler 가 지금 승인 상태로 다시 채운다. 저장값은 시작 상태다
    approval_status: approval_id === null ? null : 'pending',
    // 담당자를 못 찾은 이름 지목이다. 별칭 후보는 응답마다 이 유형·원문과 지금 별칭으로 구한다 (#523, aliasLearning).
    // '지훈' 은 누구의 별칭도 아니라 후보이고, '민수' 는 박민수의 이름 별칭이 막는다
    assignee_type: member_id === null ? 'thirdname' : null,
    alias_candidate: false,
    alias_text: null,
  }),
)
export const extractionFixtures: MockExtraction[] = [
  { extraction_id: 'ex_00', meeting_id: 'mt_07', items: [] },
  { extraction_id: 'ex_01', meeting_id: 'mt_09', items },
  {
    extraction_id: 'ex_02',
    meeting_id: 'mt_08',
    items: [
      {
        item_id: 'it_07',
        task: { title: '배포 스크립트', confidence: 0.95 },
        assignee: {
          raw: '김서연',
          member_id: 'mb_01',
          display_name: '김서연',
          confidence: 0.95,
          needs_check: false,
        },
        due_date: { value: '2026-09-24', raw: '24일', confidence: 0.9 },
        confidence: 0.9,
        gate: 'auto',
        evidence: {
          quote: '네, 배포 스크립트는 제가 24일까지 마칠게요.',
          speaker: '1123',
          speaker_member_id: 'mb_01',
          at_ms: 34_080_000,
        },
        reverted_at: null,
        task_id: 'tk_04',
        approval_id: null,
        approval_status: null,
        alias_candidate: false,
        alias_text: null,
      },
    ],
  },
]
