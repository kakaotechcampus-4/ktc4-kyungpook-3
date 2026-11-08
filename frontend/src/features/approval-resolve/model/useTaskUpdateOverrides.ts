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
  /** 제안한 마감. 비운 칸의 안내에 「원래 제안 유지」 값으로 보인다 */
  proposedDue: string | null
  /** 제안에 상태가 없다 — 상태 칸에 「원래 제안 유지」 줄이 있다 */
  statusKeepsProposal: boolean
  /** PM 이 바꾼 칸만. 마감은 키가 없으면 원래 제안 유지, null 이면 미정으로 변경이다 */
  edits: TaskUpdateEdits
  /** 담당자를 찾지 못한 답장 카드면 답장에 적힌 이름. 이때만 담당자 칸이 있다 */
  assigneePick: TaskUpdateApproval['assigneePick']
  /** 고른 담당자. undefined 는 아직 고르지 않음, null 은 미정이다 */
  assignee: string | null | undefined
  dirty: boolean
  setStatus: (value: TaskStatus | '') => void
  /** '' 는 원래 제안 유지로 돌아가고, null 은 마감을 미정으로 바꾼다 */
  setDueDate: (value: string | null) => void
  setAssignee: (value: string | null) => void
}

/** 변경 승인의 늘 열린 입력 칸 (#471). 만지지 않은 칸은 원래 제안을 그대로 둔다 */
export function useTaskUpdateOverrides(approval: TaskUpdateApproval): TaskUpdateOverrides {
  const [edits, setEdits] = useState<TaskUpdateEdits>({})
  const proposedStatus = proposed(approval, 'status')
  const initialStatus = STATUSES.find((status) => status === proposedStatus) ?? null
  const proposedDue = proposed(approval, 'due_date')
  const initialDue = typeof proposedDue === 'string' ? proposedDue : null
  // 칸의 글자는 따로 둔다. 다 지우면 원래 제안 유지(키 없음)지만 칸은 비어 있어야 이어서 칠 수 있다
  const [dueText, setDueText] = useState(initialDue ?? '')
  return {
    status: edits.status ?? initialStatus ?? '',
    dueDate: dueText,
    proposedDue: initialDue,
    statusKeepsProposal: initialStatus === null,
    edits,
    assigneePick: approval.assigneePick,
    assignee: edits.assigneeMemberId,
    dirty: Object.keys(edits).length > 0,
    setStatus: (value) =>
      setEdits((previous) => {
        const next = { ...previous }
        if (value === '') delete next.status
        else next.status = value
        return next
      }),
    setDueDate: (value) => {
      setDueText(value ?? '')
      setEdits((previous) => {
        const next = { ...previous }
        if (value === '') delete next.dueDate
        else next.dueDate = value
        return next
      })
    },
    setAssignee: (value) => setEdits((previous) => ({ ...previous, assigneeMemberId: value })),
  }
}
