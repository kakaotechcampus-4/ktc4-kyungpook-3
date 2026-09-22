import type { Extraction, ExtractionItem } from '../model/types'
// 승인을 반영해도 백엔드가 approval_id 를 비우지 않는다 (계약 §3.1, §4.0-②-12).
// 그래서 approvalId 만으로는 "아직 확인이 필요한가" 를 알 수 없다. appliedTaskId 가 우선이다.
// 이 규칙은 백엔드가 approval_id 를 비우도록 고쳐도 그대로 맞는다.
export function isPending(item: ExtractionItem): boolean {
  return item.approvalId !== null && item.appliedTaskId === null
}
export function appliedItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter((item) => item.appliedTaskId !== null)
}
export function pendingItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter(isPending)
}
export function visibleItems(extraction: Extraction, canReview: boolean): ExtractionItem[] {
  return extraction.items.filter((item) => canReview || !isPending(item))
}
