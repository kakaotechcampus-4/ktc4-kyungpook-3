import type { MeetingSource } from '@/shared/types/common'
export type { MeetingSource } from '@/shared/types/common'
/** `awaiting_speakers` 는 웹 업로드 회의만 거친다 — PM 이 화자를 지정하면 `processing` 으로 돌아간다 (계약 §2.3.1) */
export type MeetingStatus =
  'created' | 'recording' | 'processing' | 'awaiting_speakers' | 'done' | 'failed'
export interface MeetingSummary {
  id: string
  title: string
  status: MeetingStatus
  source: MeetingSource
  startedAt: string
  durationMs: number | null
  attendeeCount: number
  processedAt: string | null
  failedStage: string | null
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
  deletionAvailable: boolean
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
/** 화자 라벨의 대표 발화 구간. 원본 녹음 시작부터의 초다 (#342) */
export interface SpeakerSample {
  start: number
  end: number
}
export interface SpeakerLabel {
  label: string
  totalSec: number
  /** 최대 3개. 1개뿐이거나 0개일 수 있다 */
  samples: SpeakerSample[]
}
export interface SpeakerCandidate {
  memberId: string
  displayName: string
}
/** 화자 지정 화면의 조회. `speakers` 는 서버 순서(말한 시간 많은 순) 그대로다 */
export interface SpeakerView {
  meetingId: string
  status: MeetingStatus
  speakers: SpeakerLabel[]
  /** 업로드 때 고른 참석자 중 탈퇴하지 않은 팀원 */
  candidates: SpeakerCandidate[]
  /** 라벨 → 팀원 ID, 외부 참석자는 null. 제출 전에는 null */
  mapping: Record<string, string | null> | null
  /** 재생할 녹음. 처리가 끝나 지워졌으면 null */
  audio: { contentType: string; sizeBytes: number } | null
}
