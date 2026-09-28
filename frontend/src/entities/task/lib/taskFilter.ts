import type { Task, TaskTab } from '../model/types'
export function filterByTab(tasks: Task[], tab: Exclude<TaskTab, 'needs_review' | 'all'>): Task[] {
  return tasks.filter((task) => (tab === 'done' ? task.status === 'done' : task.status !== 'done'))
}
