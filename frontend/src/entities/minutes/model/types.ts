import type { UnknownValue } from '@/shared/api/unknownValue'
import type { SummaryStatus } from '@/shared/types/api/minutes'
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
  /** 쓸 수 있는 요약이 없으면 `null` 이다. 왜 없는지는 `summaryStatus` 가 말한다 (계약 §4.4.2) */
  summary: MinutesSummary | null
  /** 모르는 값은 받은 글자를 남긴다. 화면은 요약이 없다고만 말한다 */
  summaryStatus: SummaryStatus | UnknownValue
  transcript: TranscriptLine[]
  canReview: boolean
  canUndo: boolean
  /**
   * 지금 들을 수 있는 녹음. 없거나 보관 기간이 지났으면 null 이다 (#676).
   * 들을 수 있는지는 null 인지로만 판단한다 — 처리 중 회의는 `expiresAt` 이 지나도 들을 수 있다
   */
  audio: MinutesAudio | null
}
export interface MinutesAudio {
  contentType: string
  expiresAt: string
}
