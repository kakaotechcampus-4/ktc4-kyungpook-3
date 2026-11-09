export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type Role = 'pm' | 'member'
/** 서버 MeetingSource. 표시용 분류라 모르는 값은 응답을 거절하지 않고 `알 수 없는 출처` 로 남긴다 (#348) */
export const MEETING_SOURCES = ['discord', 'manual_upload', 'chat'] as const
export type MeetingSource = (typeof MEETING_SOURCES)[number]

export interface ExtractionEvidence {
  quote: string | null
  /** 화자의 Discord uid. 이름이 아니다 — 화면은 entities/member 의 speakerName 으로 팀원 이름을 찾는다 */
  speaker: string | null
  /** 근거 발화를 한 팀원 ID. 있으면 uid 보다 먼저 쓴다 — 업로드 회의는 uid 가 없다 (#256) */
  speakerMemberId: string | null
  atMs: number | null
}
