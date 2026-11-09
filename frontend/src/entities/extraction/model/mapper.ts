import { fallbackValue } from '@/shared/api/unknownValue'
import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'
import type { Extraction, ExtractionApprovalStatus, ExtractionGate, ExtractionItem } from './types'

const GATES: readonly ExtractionGate[] = ['auto', 'review', 'hold']
const APPROVAL_STATUSES: readonly ExtractionApprovalStatus[] = ['pending', 'approved', 'rejected']

// 없는 값(이전 서버 응답)·모르는 값은 null 이다. 승인이 걸린 항목이 null 이면 반영으로 보지 않는다(extractionView)
function approvalStatusOf(value: string | null | undefined): ExtractionApprovalStatus | null {
  return value == null
    ? null
    : fallbackValue(value, APPROVAL_STATUSES, null, 'extraction approval status')
}

export function toExtractionItem(dto: ExtractionItemDto): ExtractionItem {
  return {
    id: dto.item_id,
    title: dto.task.title,
    // 모르는 판단은 hold 로 읽는다. 자동으로 만든 태스크로 보이지 않게 한다
    gate: fallbackValue(dto.gate, GATES, 'hold', 'extraction gate'),
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
      speakerMemberId: dto.evidence.speaker_member_id,
      atMs: dto.evidence.at_ms,
    },
    appliedTaskId: dto.task_id,
    approvalId: dto.approval_id,
    approvalStatus: approvalStatusOf(dto.approval_status),
    revertedAt: dto.reverted_at ?? null,
  }
}
export function toExtraction(dto: ExtractionDto): Extraction {
  return {
    id: dto.extraction_id,
    meetingId: dto.meeting_id,
    items: dto.items.map(toExtractionItem),
  }
}
