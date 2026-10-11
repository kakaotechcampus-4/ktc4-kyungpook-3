import type { TaskStatus } from '@/entities/task'

/** 상태를 고르는 순서. 서버 TaskStatus 네 값이다 */
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'done',
] as const satisfies readonly TaskStatus[]

/** 화면에 보이는 상태 이름. 목록·상세·이력이 같은 이름을 쓴다 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '할 일',
  in_progress: '진행 중',
  blocked: '막힘',
  done: '완료',
}
