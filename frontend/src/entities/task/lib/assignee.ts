import type { Task } from '../model/types'
export interface TaskWithAssignee extends Task {
  assigneeName: string | null
}
export function withAssigneeName(task: Task, names: ReadonlyMap<string, string>): TaskWithAssignee {
  return {
    ...task,
    assigneeName:
      task.assigneeMemberId === null ? null : (names.get(task.assigneeMemberId) ?? null),
  }
}
