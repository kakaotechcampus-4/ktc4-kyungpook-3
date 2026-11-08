import { z } from 'zod'

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

/** 서버가 내는 답장 줄 종류와 결과. 응답 스키마는 문자열로 받는다 */
export type TimelineChangeField =
  'status' | 'due_date' | 'assignee' | 'scope' | 'unknown' | 'due_clear' | 'failed' | 'none'

export type TimelineChangeResult =
  'applied' | 'undone' | 'pending' | 'approved' | 'rejected' | 'noted' | 'recorded'

/*
 * 태스크 기록(`GET /tasks/{task_id}/timeline`) 응답 스키마. FE 가 읽는 필드만 본다 (#348).
 * 칸 종류(`kind`)를 모르면 그릴 수 없어 응답 전체가 `INVALID_RESPONSE` 다. 줄의 `field`·`result` 와 `channel`·`evidence_status` 는
 * 표시용이라 문자열로 받고 mapper 가 정한다. 되돌리기는 `undoable` 만 따른다
 */
export const timelineChangeSchema = z.object({
  change_id: z.string(),
  field: z.string(),
  new_value: z.string().nullable(),
  evidence_status: z.string().nullable(),
  /** AI 해석. 대화 주인과 PM 에게만 온다 */
  summary: z.string().nullable(),
  /** 대화 주인과 PM 에게만 온다 */
  evidence_quote: z.string().nullable(),
  result: z.string(),
  undoable: z.boolean(),
})
export type TimelineChangeDto = z.infer<typeof timelineChangeSchema>

export const timelineReplySchema = z.object({
  kind: z.literal('reply'),
  at: z.string(),
  message_id: z.string(),
  member_name: z.string(),
  channel: z.string().nullable(),
  /** 대화 주인과 PM 에게만 온다 */
  body: z.string().nullable(),
  changes: z.array(timelineChangeSchema),
})
export type TimelineReplyDto = z.infer<typeof timelineReplySchema>

/** 답장에 이어지지 않은 이력 한 줄. `/history` 의 같은 이력과 history_id 가 같다 */
export const timelineHistorySchema = z.object({
  kind: z.literal('history'),
  at: z.string(),
  history_id: z.string(),
  changed_field: z.string(),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  change_source: z.string(),
})
export type TimelineHistoryDto = z.infer<typeof timelineHistorySchema>

export const timelineItemSchema = z.discriminatedUnion('kind', [
  timelineReplySchema,
  timelineHistorySchema,
])
export type TimelineItemDto = z.infer<typeof timelineItemSchema>

export const timelineListSchema = z.object({ items: z.array(timelineItemSchema) })
