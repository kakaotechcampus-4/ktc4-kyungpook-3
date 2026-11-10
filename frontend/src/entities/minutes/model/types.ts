import type { UnknownValue } from '@/shared/api/unknownValue'
import type { SummaryStatus } from '@/shared/types/api/minutes'
import type { MeetingSource } from '@/shared/types/common'
export interface MinutesAttendee {
  memberId: string
  displayName: string
}
export interface TranscriptLine {
  /** 줄 고치기에 쓰는 발화 번호. 모르면 그 줄은 고칠 수 없다 (§4.4.3) */
  seq: number | null
  atMs: number
  speakerMemberId: string | null
  speakerName: string
  isFallbackName: boolean
  /** 팀원이 고쳤으면 고친 문장이다 */
  text: string
  edited: boolean
  /** 고친 줄의 원문. 고치지 않았거나 서버가 주지 않았으면 null 이다 */
  originalText: string | null
}
export interface MinutesSummary {
  overview: string
  keyPoints: string[]
  decisions: string[]
}
export interface Minutes {
  meetingId: string
  title: string
  titleEdited: boolean
  /** 처음 제목. 고친 적 없거나 제목 없던 회의를 고쳤으면 null 이다 */
  titleOriginal: string | null
  startedAt: string
  durationMs: number
  /** 모르는 출처는 받은 글자를 남긴다 — 회의 안 시각을 보이지 않는다 (#348) */
  source: MeetingSource | UnknownValue
  attendees: MinutesAttendee[]
  /** 쓸 수 있는 요약이 없으면 `null` 이다. 왜 없는지는 `summaryStatus` 가 말한다 (계약 §4.4.2) */
  summary: MinutesSummary | null
  /** 모르는 값은 받은 글자를 남긴다. 화면은 요약이 없다고만 말한다 */
  summaryStatus: SummaryStatus | UnknownValue
  /** 남은 승인 요청 수. PM 에게만 숫자이고 `awaiting_approval` 일 때만 뜻이 있다 (D-104) */
  summaryWaitingCount: number | null
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

/** 제목 고치기 응답. 회의록과 같은 칸이다 */
export interface TitleEdit {
  meetingId: string
  title: string
  titleEdited: boolean
  titleOriginal: string | null
}

/** 발화 고치기 응답. `seq` 로 회의록의 그 줄을 바꾼다 */
export type LineEdit = Pick<TranscriptLine, 'text' | 'edited' | 'originalText'> & { seq: number }
