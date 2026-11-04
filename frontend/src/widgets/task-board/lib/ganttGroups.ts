import type { TaskCreateApproval } from '@/entities/approval'
import type { Member } from '@/entities/member'
import type { Task } from '@/entities/task'

export interface Group {
  key: string
  /** 이니셜 원에 쓰는 이름. 모르면 null */
  name: string | null
  label: string
  note: string
  tasks: Task[]
  approvals: TaskCreateApproval[]
}

type Items = Pick<Group, 'tasks' | 'approvals'>

/** 팀원 목록에서 찾지 못한 담당자의 일(팀원 조회 실패 포함)은 `미지정` 이 아니라 `알 수 없는 담당자` 로 모은다 */
export function groupRows(
  members: readonly Member[],
  tasks: readonly Task[],
  approvals: readonly TaskCreateApproval[],
): { groups: Group[]; unscheduledTasks: Task[]; unscheduledApprovals: TaskCreateApproval[] } {
  const byMember = new Map<string, Items>(
    members.map(({ id }) => [id, { tasks: [], approvals: [] }]),
  )
  const unknown: Items = { tasks: [], approvals: [] }
  const unassigned: Items = { tasks: [], approvals: [] }
  const itemsOf = (assigneeMemberId: string | null) =>
    assigneeMemberId === null ? unassigned : (byMember.get(assigneeMemberId) ?? unknown)
  const unscheduledTasks: Task[] = []
  const unscheduledApprovals: TaskCreateApproval[] = []
  for (const task of tasks) {
    if (task.dueDate === null) unscheduledTasks.push(task)
    else itemsOf(task.assigneeMemberId).tasks.push(task)
  }
  for (const approval of approvals) {
    if (approval.dueDate === null) unscheduledApprovals.push(approval)
    else itemsOf(approval.assigneeMemberId).approvals.push(approval)
  }
  const groups: Group[] = [
    ...members.map((member) => ({
      key: member.id,
      name: member.displayName,
      label: member.displayName,
      note: member.role === 'pm' ? 'PM' : '팀원',
      ...itemsOf(member.id),
    })),
    {
      key: 'unknown',
      name: null,
      label: '알 수 없는 담당자',
      note: '팀원 정보를 찾지 못했어요',
      ...unknown,
    },
    {
      key: 'unassigned',
      name: null,
      label: '미지정',
      note: '승인하면 담당자가 붙습니다',
      ...unassigned,
    },
  ]
  return {
    groups: groups.filter(({ tasks: t, approvals: a }) => t.length + a.length > 0),
    unscheduledTasks,
    unscheduledApprovals,
  }
}
