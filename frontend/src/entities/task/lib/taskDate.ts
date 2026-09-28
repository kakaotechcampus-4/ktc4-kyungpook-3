import type { Task } from '../model/types'
export function isOverdue(task: Task, today: string): boolean {
  return task.status !== 'done' && task.dueDate !== null && task.dueDate < today
}
export function isDueSoon(task: Task, today: string, until: string): boolean {
  return (
    task.status !== 'done' &&
    task.dueDate !== null &&
    task.dueDate >= today &&
    task.dueDate <= until
  )
}
