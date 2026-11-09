import { z } from 'zod'

/*
 * 추출 응답 스키마 (backend app/schemas/meeting.py ExtractionDetailResponse·ExtractionItemRevertResponse). FE 가 읽는 필드만
 * 본다. 확신도·`needs_check`·별칭 후보는 화면이 읽지 않아 보지 않는다. 타입은 이 스키마에서 만든다 (#348)
 */

export const extractionItemSchema = z.object({
  item_id: z.string(),
  task: z.object({ title: z.string() }),
  assignee: z.object({
    raw: z.string().nullable(),
    member_id: z.string().nullable(),
    display_name: z.string().nullable(),
  }),
  due_date: z.object({ value: z.string().nullable(), raw: z.string().nullable() }),
  // auto | review | hold. 모르는 값은 mapper 가 보수 폴백으로 hold 로 읽는다(자동 생성으로 보이지 않음)
  gate: z.string(),
  evidence: z.object({
    quote: z.string().nullable(),
    speaker: z.string().nullable(),
    at_ms: z.number().nullable(),
    speaker_member_id: z.string().nullable(),
  }),
  // auto 로 만든 태스크를 PM 이 되돌린 시각. 되돌려도 gate 는 auto 로 남는다. 빠진 옛 응답은 되돌리지 않은 것이다
  reverted_at: z.string().nullish(),
  task_id: z.string().nullable(),
  approval_id: z.string().nullable(),
  // 연결된 승인의 지금 상태(pending | approved | rejected). 모르는 값·빠진 옛 응답은 mapper 가 null(반영으로 보지 않음)로 둔다
  approval_status: z.string().nullish(),
})
export type ExtractionItemDto = z.infer<typeof extractionItemSchema>

export const extractionSchema = z.object({
  extraction_id: z.string(),
  meeting_id: z.string(),
  items: z.array(extractionItemSchema),
})
export type ExtractionDto = z.infer<typeof extractionSchema>

/** `POST /extractions/{extraction_id}/items/{item_id}/revert` 응답. 새 생성 승인은 pending 이다 */
export const extractionItemRevertSchema = z.object({
  item_id: z.string(),
  reverted_task_id: z.string(),
  approval_id: z.string(),
  reverted_at: z.string(),
})
export type ExtractionItemRevertDto = z.infer<typeof extractionItemRevertSchema>

/**
 * 409 AUTO_TASK_NOT_REVERTIBLE 의 `details` (backend extractions.revert_auto_item). `reason` 은 표시용 분류라 문자열로 받고,
 * `reason` 에 따라 붙는 ID 는 모양이 틀리면 없는 것으로 둔다
 */
export const autoTaskNotRevertibleDetailsSchema = z.object({
  reason: z.string().catch(''),
  task_id: z.string().optional().catch(undefined),
  approval_id: z.string().optional().catch(undefined),
})
