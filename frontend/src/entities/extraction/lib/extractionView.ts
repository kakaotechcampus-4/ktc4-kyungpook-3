import type { Extraction, ExtractionItem } from '../model/types'
export function appliedItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter((item) => item.appliedTaskId !== null)
}
export function pendingItems(extraction: Extraction): ExtractionItem[] {
  return extraction.items.filter((item) => item.approvalId !== null)
}
export function visibleItems(extraction: Extraction, canReview: boolean): ExtractionItem[] {
  return extraction.items.filter((item) => canReview || item.approvalId === null)
}
