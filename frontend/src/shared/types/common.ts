export type Role = 'pm' | 'member'
export type MeetingSource = 'discord' | 'manual_upload'

export interface ExtractionEvidence {
  quote: string | null
  /** 화자의 Discord uid. 이름이 아니다 — 화면은 entities/member 의 speakerName 으로 팀원 이름을 찾는다 */
  speaker: string | null
  atMs: number | null
}
