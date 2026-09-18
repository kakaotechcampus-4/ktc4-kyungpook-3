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
  source: MeetingSource
  attendees: MinutesAttendee[]
  summary: MinutesSummary
  transcript: TranscriptLine[]
  canReview: boolean
  canUndo: boolean
}
