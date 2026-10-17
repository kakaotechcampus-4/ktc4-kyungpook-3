import type { ExtractionDto, ExtractionItemDto } from '@/shared/types/api/extraction'
import { enumValue } from '@/shared/lib/enum'
import type { Extraction, ExtractionApprovalStatus, ExtractionItem } from './types'

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const

// 없는 값(이전 서버 응답)은 null 이다. 모르는 값은 대기로 보지 않고 null 로 내린다 — 승인 상태로 판정하는 곳이 없어 경고만 남긴다
function approvalStatusOf(value: string | null | undefined): ExtractionApprovalStatus | null {
  if (value === null || value === undefined) return null
  if ((APPROVAL_STATUSES as readonly string[]).includes(value))
    return value as ExtractionApprovalStatus
  if (import.meta.env.DEV) console.warn(`Unknown extraction approval status: ${value}`)
  return null
}

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
