export type Role = 'pm' | 'member'
export type MeetingSource = 'discord' | 'manual_upload'

export interface ExtractionEvidence {
  quote: string
  speaker: string
  atMs: number
}
