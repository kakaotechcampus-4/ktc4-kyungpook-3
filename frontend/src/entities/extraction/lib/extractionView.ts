import type { Extraction, ExtractionItem } from '../model/types'

/** 태스크에 반영됐다.
 *
 * `task_id` 만으로는 알 수 없다. 수정 항목은 승인 전에도 `task_id` 가 수정 대상 태스크이고(#419),
 * 백엔드는 승인·반려 뒤에도 `approval_id` 를 비우지 않는다(계약 §4.0-②-12). 승인이 걸린 항목은
 * `approval_status` 가 `approved` 일 때만 반영이다. 모르는 승인 상태(null)는 반영으로 보지 않는다.
 */
function isApplied(item: ExtractionItem): boolean {
  return (
    item.appliedTaskId !== null && (item.approvalId === null || item.approvalStatus === 'approved')
  )
}

/** 승인이 걸려 있고 반영되지 않았다. 대기와 반려를 모두 포함한다 (계약 §3.1) */
export function isUnresolved(item: ExtractionItem): boolean {
  return item.approvalId !== null && !isApplied(item)
}

export function appliedItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter(isApplied)
}

/** `확인 필요` — PM 전용.
 *
 * `openApprovalIds` 는 `GET /approvals?workspace_id=&status=pending` 의 승인 ID 집합이다.
 * 행마다 그 승인의 빠진 값으로 이유를 보이므로 `approval_status` 만 보지 않고 대기 목록과 조인한다.
 * 반영된 항목은 대기 목록이 늦게 갱신돼도 빼서 `반영 완료` 와 겹치지 않게 한다.
 *
 * `entities → entities` 를 피해 `Approval` 이 아니라 ID 집합만 받는다. 그 집합은 두 엔티티를
 * 모두 볼 수 있는 `widgets` 가 만든다 (§3-2 의 조인 규칙과 같다).
 */
export function pendingItems(
  extraction: Extraction,
  openApprovalIds: ReadonlySet<string>,
): ExtractionItem[] {
  return extraction.items.filter(
    (item) => !isApplied(item) && item.approvalId !== null && openApprovalIds.has(item.approvalId),
  )
}

/** 일반 팀원에게는 해결되지 않은 항목을 숨긴다. 개수에서도 뺀다 (D-104).
 *
 * 대기든 반려든 반영된 태스크가 없어 둘 다 숨기는 것이 맞다. `approval_status` 로 판정하므로
 * D-163 대로 일반 팀원은 승인 목록을 조회하지 않는다.
 */
export function visibleItems(extraction: Extraction, canReview: boolean): ExtractionItem[] {
  return extraction.items.filter((item) => canReview || !isUnresolved(item))
}
