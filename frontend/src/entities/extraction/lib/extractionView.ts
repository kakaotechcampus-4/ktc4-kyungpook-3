import type { Extraction, ExtractionItem } from '../model/types'

/** 태스크가 만들어지지 않았고 승인이 걸려 있다.
 *
 * 대기 중인지 반려됐는지는 **여기서 알 수 없다.** 백엔드는 승인·반려 어느 쪽으로 닫혀도
 * `extraction_item.approval_id` 를 비우지 않고, 반려는 `extraction_item` 을 아예 건드리지 않아
 * 두 경우의 응답이 완전히 같다. `ExtractionItemResponse` 에 승인 상태 필드도 없다
 * (계약 §3.1, §4.0-②-12).
 */
export function isUnresolved(item: ExtractionItem): boolean {
  return item.approvalId !== null && item.appliedTaskId === null
}

export function appliedItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter((item) => item.appliedTaskId !== null)
}

/** `확인 필요` — PM 전용.
 *
 * `openApprovalIds` 는 `GET /approvals?workspace_id=&status=pending` 의 승인 ID 집합이다.
 * 승인이든 반려든 닫힌 승인은 그 목록에서 빠지므로 자동으로 제외된다.
 * 백엔드가 §4.0-②-12 를 고쳐 `approval_id` 를 비우게 되어도 이 판정은 그대로 맞다.
 *
 * `entities → entities` 를 피해 `Approval` 이 아니라 ID 집합만 받는다. 그 집합은 두 엔티티를
 * 모두 볼 수 있는 `widgets` 가 만든다 (§3-2 의 조인 규칙과 같다).
 */
export function pendingItems(
  extraction: Extraction,
  openApprovalIds: ReadonlySet<string>,
): ExtractionItem[] {
  return extraction.items.filter(
    (item) =>
      item.appliedTaskId === null &&
      item.approvalId !== null &&
      openApprovalIds.has(item.approvalId),
  )
}

/** 일반 팀원에게는 해결되지 않은 항목을 숨긴다. 개수에서도 뺀다 (D-104).
 *
 * 여기서는 조인이 필요 없다. 대기든 반려든 보여줄 태스크가 없어 둘 다 숨기는 것이 맞고,
 * D-163 대로 일반 팀원은 승인 목록을 조회하지 않는다.
 */
export function visibleItems(extraction: Extraction, canReview: boolean): ExtractionItem[] {
  return extraction.items.filter((item) => canReview || !isUnresolved(item))
}
