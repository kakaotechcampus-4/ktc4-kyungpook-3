export interface MinutesDto {
  meeting_id: string
  title: string
  started_at: string
  duration_ms: number
  source: string
  attendees: { member_id: string; display_name: string }[]
  summary: { overview: string; key_points: string[]; decisions: string[] }
  transcript: {
    at_ms: number
    speaker_member_id: string | null
    speaker_display_name: string | null
    speaker_fallback: string
    text: string
  }[]
  permissions: { can_review: boolean; can_undo: boolean }
}
