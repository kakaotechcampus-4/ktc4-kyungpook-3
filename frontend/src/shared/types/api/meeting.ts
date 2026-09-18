export interface MeetingSummaryDto {
  meeting_id: string
  title: string
  status: string
  source: string
  started_at: string
  duration_ms: number | null
  attendee_count: number
  processed_at: string | null
}
export interface MeetingDto {
  meeting_id: string
  workspace_id: string
  title: string
  status: string
  started_at: string
  ended_at: string | null
  extraction_id: string | null
  failed_stage: string | null
  progress?: { audio_merged: boolean; transcribed: boolean; extracted: boolean } | null
}
