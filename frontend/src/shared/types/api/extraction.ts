export interface ExtractionItemDto {
  item_id: string
  task: { title: string; confidence: number }
  assignee: {
    raw: string | null
    member_id: string | null
    display_name: string | null
    confidence: number
    needs_check: boolean
  }
  due_date: { value: string | null; raw: string | null; confidence: number }
  confidence: number
  gate: string
  evidence: { quote: string | null; speaker: string | null; at_ms: number | null }
  /** auto 로 만든 태스크를 PM 이 되돌린 시각. 되돌려도 gate 는 auto 로 남는다. 되돌리지 않았으면 null */
  reverted_at: string | null
  task_id: string | null
  approval_id: string | null
  /** 연결된 승인 요청의 지금 상태(pending | approved | rejected). 승인 요청이 없으면 null */
  approval_status: string | null
}
/** `POST /extractions/{extraction_id}/items/{item_id}/revert` 응답. 새 생성 승인은 pending 이다 */
export interface ExtractionItemRevertDto {
  item_id: string
  reverted_task_id: string
  approval_id: string
  reverted_at: string
}

/** 409 AUTO_TASK_NOT_REVERTIBLE 의 `details`. `reason` 에 따라 `task_id`·`task_version`·`approval_id` 가 붙는다 */
export interface AutoTaskNotRevertibleDetailsDto {
  item_id: string
  reason: string
  task_id?: string
  task_version?: number
  approval_id?: string
}

export interface ExtractionDto {
  extraction_id: string
  meeting_id: string
  items: ExtractionItemDto[]
}
