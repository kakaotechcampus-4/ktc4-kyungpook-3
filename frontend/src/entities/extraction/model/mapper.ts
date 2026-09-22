import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'
import { enumValue } from '@/shared/lib/enum'
import type { Extraction, ExtractionItem } from './types'

export function toExtractionItem(dto: ExtractionItemDto): ExtractionItem {
  return {
    id: dto.item_id,
    title: dto.task.title,
    confidence: dto.confidence,
    gate: enumValue(dto.gate, ['auto', 'review', 'hold'] as const, 'hold', 'extraction gate'),
    assigneeMemberId: dto.assignee.member_id,
    assigneeLabel:
      (dto.assignee.member_id !== null ? dto.assignee.display_name : null) ??
      dto.assignee.raw ??
      '',
    dueDate: dto.due_date.value,
    dueRaw: dto.due_date.raw,
    evidence: {
      quote: dto.evidence.quote,
      speaker: dto.evidence.speaker,
      atMs: dto.evidence.at_ms,
    },
    appliedTaskId: dto.task_id,
    approvalId: dto.approval_id,
  }
}
export function toExtraction(dto: ExtractionDto): Extraction {
  return {
    id: dto.extraction_id,
    meetingId: dto.meeting_id,
    items: dto.items.map(toExtractionItem),
  }
}
