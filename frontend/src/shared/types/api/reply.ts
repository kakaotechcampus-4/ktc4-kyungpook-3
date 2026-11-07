/*
 * 리마인드 답장 판단 (계약 §5.7 「리마인드 답장 판단」). backend/app/schemas/reply.py 와 칸을 1:1 로 맞춘다
 */

export interface TaskRefDto {
  task_id: string
  title: string
}

/** 어느 태스크인지 PM 이 골라야 하는 답장. 지운 태스크는 후보에 없다 */
export interface NeedsPickAttributionDto {
  message_id: string
  status: 'needs_pm'
  candidates: TaskRefDto[]
  task: null
}

/** PM 이 고른 답장. `task` 가 null 이면 해당 없음이다 */
export interface ResolvedAttributionDto {
  message_id: string
  status: 'resolved'
  candidates: null
  task: TaskRefDto | null
}

export type ReplyAttributionDto = NeedsPickAttributionDto | ResolvedAttributionDto

export interface AttributionRequestDto {
  /** null 이면 해당 없음 */
  task_id: string | null
}

export interface AttributionResponseDto {
  message_id: string
}

export type TimelineChangeField =
  'status' | 'due_date' | 'assignee' | 'scope' | 'unknown' | 'due_clear' | 'failed' | 'none'

export type TimelineChangeResult =
  'applied' | 'undone' | 'pending' | 'approved' | 'rejected' | 'noted' | 'recorded'

export interface TimelineChangeDto {
  change_id: string
  field: TimelineChangeField
  new_value: string | null
  evidence_status: 'certain' | 'inferred' | null
  /** AI 해석. 대화 주인과 PM 에게만 온다 */
  summary: string | null
  /** 대화 주인과 PM 에게만 온다 */
  evidence_quote: string | null
  result: TimelineChangeResult
  undoable: boolean
}

export interface TimelineReplyDto {
  kind: 'reply'
  at: string
  message_id: string
  member_name: string
  channel: 'discord' | 'web' | null
  /** 대화 주인과 PM 에게만 온다 */
  body: string | null
  changes: TimelineChangeDto[]
}

/** 답장에 이어지지 않은 이력 한 줄. `/history` 의 같은 이력과 history_id 가 같다 */
export interface TimelineHistoryDto {
  kind: 'history'
  at: string
  history_id: string
  changed_field: string
  old_value: string | null
  new_value: string | null
  change_source: string
}

export type TimelineItemDto = TimelineReplyDto | TimelineHistoryDto
