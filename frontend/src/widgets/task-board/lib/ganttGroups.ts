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

/**
 * 팀원별로 묶는다. 담당자가 없는 일은 `미지정` 이, 팀원 목록에서 찾지 못한 담당자의 일(팀원 조회 실패 포함)은
 * `알 수 없는 담당자` 가 모은다 — 받지 못한 담당자를 미지정으로 그리지 않는다. 일정이 없는 일은 아래 목록으로 간다
 */
export function groupRows(
  members: readonly Member[],
  tasks: readonly Task[],
  approvals: readonly TaskCreateApproval[],
): { groups: Group[]; unscheduledTasks: Task[]; unscheduledApprovals: TaskCreateApproval[] } {
  const scheduledTasks = tasks.filter((task) => task.dueDate !== null)
  const scheduledApprovals = approvals.filter((approval) => approval.dueDate !== null)
  const groups: Group[] = members.map((member) => ({
    key: member.id,
    name: member.displayName,
    label: member.displayName,
    note: member.role === 'pm' ? 'PM' : '팀원',
    tasks: scheduledTasks.filter((task) => task.assigneeMemberId === member.id),
    approvals: scheduledApprovals.filter((approval) => approval.assigneeMemberId === member.id),
  }))
  const known = new Set(members.map(({ id }) => id))
  const unknown = ({ assigneeMemberId }: { assigneeMemberId: string | null }) =>
    assigneeMemberId !== null && !known.has(assigneeMemberId)
  groups.push(
    {
      key: 'unknown',
      name: null,
      label: '알 수 없는 담당자',
      note: '팀원 정보를 찾지 못했어요',
      tasks: scheduledTasks.filter(unknown),
      approvals: scheduledApprovals.filter(unknown),
    },
    {
      key: 'unassigned',
      name: null,
      label: '미지정',
      note: '승인하면 담당자가 붙습니다',
      tasks: scheduledTasks.filter((task) => task.assigneeMemberId === null),
      approvals: scheduledApprovals.filter((approval) => approval.assigneeMemberId === null),
    },
  )
  return {
    groups: groups.filter(({ tasks: t, approvals: a }) => t.length + a.length > 0),
    unscheduledTasks: tasks.filter((task) => task.dueDate === null),
    unscheduledApprovals: approvals.filter((approval) => approval.dueDate === null),
  }
}
