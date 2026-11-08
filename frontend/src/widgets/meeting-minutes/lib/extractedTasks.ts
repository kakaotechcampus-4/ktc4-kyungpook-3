import type { Approval } from '@/entities/approval'
import { approvalIds } from '@/entities/approval'
import type { Extraction, ExtractionItem } from '@/entities/extraction'
import { appliedItems, pendingItems } from '@/entities/extraction'

export interface PendingTask {
  item: ExtractionItem
  /** 항목과 이어진 대기 승인. `확인하기` 가 이 승인의 상세로 간다 */
  approvalId: string
  /** 무엇을 확인해야 하는지 — 승인 payload 의 빠진 값으로 만든다 */
  reason: string
}

export interface ExtractedTasks {
  /** `반영된 것` — 태스크에 반영된 항목. 승인으로 반영된 항목도 여기 한 번만 있다 */
  applied: ExtractionItem[]
  /** `확인이 필요한 일` — 대기 승인과 이어진 항목. 볼 수 없는 사람(일반 팀원)이면 null */
  pending: PendingTask[] | null
}

function reasonOf(approval: Approval | undefined): string {
  const missing = approval?.kind === 'task_create' ? approval.missing : []
  if (missing.includes('assignee') && missing.includes('due')) return '담당자와 마감을 정해야 해요'
  if (missing.includes('assignee')) return '담당자를 정해야 해요'
  if (missing.includes('due')) return '마감을 정해야 해요'
  return '내용을 확인해야 해요'
}

/**
 * 회의록의 태스크 영역 (U5-5). 추출과 승인 두 엔티티를 잇는 자리라 widget 에 있다 (계약 §3.1, §5.5).
 *
 * - 반영 = `appliedItems` — `task_id` 가 있고 승인이 없거나 `approval_status` 가 `approved` 인 항목.
 *   수정 제안은 승인 전에도 `task_id` 가 있어 `task_id` 만으로는 고르지 않는다 (#419).
 * - 확인 필요 = 반영되지 않은 항목 ∩ 대기 승인 ID. 반려·승인으로 닫힌 승인은 대기 목록에 없어 빠진다.
 * - `openApprovals` 가 null 이면 확인 필요를 만들지 않는다 — 일반 팀원은 승인 목록을 부르지 않는다 (D-104, D-163).
 */
export function extractedTasks(
  extraction: Extraction,
  openApprovals: readonly Approval[] | null,
): ExtractedTasks {
  if (openApprovals === null) return { applied: appliedItems(extraction), pending: null }
  const byId = new Map(openApprovals.map((approval) => [approval.id, approval]))
  return {
    applied: appliedItems(extraction),
    pending: pendingItems(extraction, approvalIds(openApprovals)).flatMap((item) =>
      // pendingItems 가 approvalId 가 있고 대기 목록에 있는 항목만 고른다
      item.approvalId === null
        ? []
        : [{ item, approvalId: item.approvalId, reason: reasonOf(byId.get(item.approvalId)) }],
    ),
  }
}
