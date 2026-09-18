export interface ExtractionItemDto {
  item_id: string
  task: { title: string; confidence: number }
  assignee: {
    raw: string
    member_id: string | null
    display_name: string | null
    confidence: number
    needs_check: boolean
  }
  due_date: { value: string | null; raw: string | null; confidence: number }
  confidence: number
  gate: string
  evidence: { quote: string; speaker: string; at_ms: number }
  task_id: string | null
  approval_id: string | null
}
export interface ExtractionDto {
  extraction_id: string
  meeting_id: string
  items: ExtractionItemDto[]
}
