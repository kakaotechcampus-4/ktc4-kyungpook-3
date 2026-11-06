import { useState } from 'react'
import type { TaskUpdateApproval, TaskUpdateEdits } from '@/entities/approval'
import type { TaskStatus } from '@/shared/types/common'

const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

function proposed(approval: TaskUpdateApproval, field: string): unknown {
  return approval.changes.find((change) => change.field === field)?.value
}

export interface TaskUpdateOverrides {
  /** 칸에 보이는 값. '' 는 상태면 원래 제안 유지, 마감이면 비어 있음이다 */
  status: TaskStatus | ''
  dueDate: string
  /** 제안에 상태가 없다 — 상태 칸에 「원래 제안 유지」 줄이 있다 */
  statusKeepsProposal: boolean
  /** PM 이 만진 칸만. 마감을 만진 뒤 비우면 null(미정)이다 */
  edits: TaskUpdateEdits
  dirty: boolean
  setStatus: (value: TaskStatus | '') => void
  setDueDate: (value: string) => void
}

/** 변경 승인의 늘 열린 입력 칸 (#471). 만지지 않은 칸은 원래 제안을 그대로 둔다 */
export function useTaskUpdateOverrides(approval: TaskUpdateApproval): TaskUpdateOverrides {
  const [edits, setEdits] = useState<TaskUpdateEdits>({})
  const proposedStatus = proposed(approval, 'status')
  const initialStatus = STATUSES.find((status) => status === proposedStatus) ?? null
  const proposedDue = proposed(approval, 'due_date')
  const initialDue = typeof proposedDue === 'string' ? proposedDue : ''
  return {
    status: edits.status ?? initialStatus ?? '',
    dueDate: edits.dueDate === undefined ? initialDue : (edits.dueDate ?? ''),
    statusKeepsProposal: initialStatus === null,
    edits,
    dirty: Object.keys(edits).length > 0,
    setStatus: (value) =>
      setEdits((previous) => {
        const next = { ...previous }
        if (value === '') delete next.status
        else next.status = value
        return next
      }),
    setDueDate: (value) => setEdits((rest) => ({ ...rest, dueDate: value === '' ? null : value })),
  }
}
