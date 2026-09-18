import type { Approval } from '../model/types'
export function sortByWaiting(approvals: readonly Approval[]): Approval[] {
  return [...approvals].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
