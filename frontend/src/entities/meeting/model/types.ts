import type { MeetingSource } from '@/shared/types/common'
export type { MeetingSource } from '@/shared/types/common'
export type MeetingStatus = 'created' | 'recording' | 'processing' | 'done' | 'failed'
export interface MeetingSummary {
  id: string
  title: string
  status: MeetingStatus
  source: MeetingSource
  startedAt: string
  durationMs: number | null
  attendeeCount: number
  processedAt: string | null
}
export interface MeetingProgress {
  audioMerged: boolean
  transcribed: boolean
  extracted: boolean
}
export interface Meeting {
  id: string
  workspaceId: string
  title: string
  status: MeetingStatus
  startedAt: string
  endedAt: string | null
  extractionId: string | null
  failedStage: string | null
  progress: MeetingProgress | null
}
/** 업로드 요청. 회의 시각은 ISO 문자열이다 — 날짜를 고치지 않았으면 파일의 원래 시각이다 (D-079, D-164) */
export interface UploadMeetingInput {
  file: File
  title: string
  startedAt: string
  /** 현재 워크스페이스에 등록된 팀원 ID. 1명 이상 (D-085, D-086) */
  attendeeMemberIds: string[]
}
/** 업로드 202 응답. 정리는 서버에서 이어지고 상태는 상세로 따라간다 */
export interface MeetingUploadResult {
  id: string
  status: MeetingStatus
}
