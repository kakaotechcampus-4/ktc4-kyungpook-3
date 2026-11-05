export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type Role = 'pm' | 'member'
export type MeetingSource = 'discord' | 'manual_upload' | 'chat'

export interface ExtractionEvidence {
  quote: string | null
  /** 화자의 Discord uid. 이름이 아니다 — 화면은 entities/member 의 speakerName 으로 팀원 이름을 찾는다 */
  speaker: string | null
  /** 근거 발화를 한 팀원 ID. 있으면 uid 보다 먼저 쓴다 — 업로드 회의는 uid 가 없다 (#256) */
  speakerMemberId: string | null
  atMs: number | null
}
