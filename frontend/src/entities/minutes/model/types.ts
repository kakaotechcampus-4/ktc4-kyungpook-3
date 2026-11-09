import type { UnknownValue } from '@/shared/api/unknownValue'
import type { MeetingSource } from '@/shared/types/common'
export interface MinutesAttendee {
  memberId: string
  displayName: string
}
export interface TranscriptLine {
  atMs: number
  speakerMemberId: string | null
  speakerName: string
  isFallbackName: boolean
  text: string
}
export interface MinutesSummary {
  overview: string
  keyPoints: string[]
  decisions: string[]
}
export interface Minutes {
  meetingId: string
  title: string
  startedAt: string
  durationMs: number
  /** 모르는 출처는 받은 글자를 남긴다 — 회의 안 시각을 보이지 않는다 (#348) */
  source: MeetingSource | UnknownValue
  attendees: MinutesAttendee[]
  /** 실 API 에서는 항상 `null` 이다. 요약을 채우는 경로가 아직 없다 (계약 §4.0-②-11) */
  summary: MinutesSummary | null
  transcript: TranscriptLine[]
  canReview: boolean
  canUndo: boolean
}
