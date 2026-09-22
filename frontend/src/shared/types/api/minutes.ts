export interface MinutesDto {
  meeting_id: string
  // 백엔드 MeetingMinutesResponse 는 title 과 summary 가 nullable 이다.
  // summary 는 Extraction.summary 를 채우는 쪽이 없어 실 API 에서 항상 null 이다 (계약 §4.0-②-11)
  title: string | null
  started_at: string
  duration_ms: number
  source: string
  attendees: { member_id: string; display_name: string }[]
  summary: { overview: string; key_points: string[]; decisions: string[] } | null
  transcript: {
    at_ms: number
    speaker_member_id: string | null
    speaker_display_name: string | null
    speaker_fallback: string
    text: string
  }[]
  permissions: { can_review: boolean; can_undo: boolean }
}
