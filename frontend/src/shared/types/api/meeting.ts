export interface MeetingSummaryDto {
  meeting_id: string
  // 백엔드 Meeting.title 이 nullable 이고 목록은 그 값을 그대로 내린다.
  // items 가 list[dict] 라 스키마에 드러나지 않으므로 이 선언이 유일한 기록이다 (계약 §4.0-②-14)
  title: string | null
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
  title: string | null
  status: string
  started_at: string
  ended_at: string | null
  extraction_id: string | null
  failed_stage: string | null
  progress?: { audio_merged: boolean; transcribed: boolean; extracted: boolean } | null
}
export interface MeetingCreateDto {
  meeting_id: string
  workspace_id: string
  status: string
  started_at: string
}
export interface MeetingEndDto {
  meeting_id: string
  status: string
  ended_at: string | null
}
export interface MeetingUploadDto {
  meeting_id: string
  status: string
}
