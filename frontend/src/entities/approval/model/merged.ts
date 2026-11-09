import { taskCreateValues } from './resolution'
import type { TaskCreateFields } from './resolution'
import type { MergedApprovalItem, TaskCreateApproval } from './types'

/** 카드에 모인 회의·항목 수. 카드를 만든 항목도 센다. 합쳐지지 않은 카드는 null 이다 (#512) */
export function mergedCount(
  approval: TaskCreateApproval,
): { meetings: number; items: number } | null {
  if (approval.mergedItems.length === 0) return null
  const meetings = new Set(
    [approval.meetingId, ...approval.mergedItems.map(({ meetingId }) => meetingId)].filter(
      (id) => id !== null,
    ),
  )
  return { meetings: meetings.size, items: approval.mergedItems.length + 1 }
}

export interface ApprovalChange {
  /** 제안 값이 바뀐 칸 */
  fields: (keyof TaskCreateFields)[]
  /** 그 사이에 합쳐진 항목 */
  addedItems: MergedApprovalItem[]
}

const FIELDS = ['taskTitle', 'assigneeMemberId', 'dueDate'] as const

/** PM 이 본 카드와 새로 받은 카드의 차이. 서버는 어느 칸이 바뀌었는지 주지 않는다 (#547) */
export function approvalChange(
  before: TaskCreateApproval,
  after: TaskCreateApproval,
): ApprovalChange {
  const was = taskCreateValues(before)
  const now = taskCreateValues(after)
  const known = new Set(before.mergedItems.map(({ extractionItemId }) => extractionItemId))
  return {
    fields: FIELDS.filter((field) => was[field] !== now[field]),
    addedItems: after.mergedItems.filter(({ extractionItemId }) => !known.has(extractionItemId)),
  }
}
