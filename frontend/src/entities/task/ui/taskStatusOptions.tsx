import type { SelectOption } from '@/shared/ui/select'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../model/status'
import type { TaskStatus } from '../model/types'
import { TaskStatusMark } from './TaskStatusMark'

/** 상태 선택 상자의 줄 — 표식과 이름, 고르는 순서대로 */
export const TASK_STATUS_OPTIONS: readonly SelectOption<TaskStatus>[] = TASK_STATUSES.map(
  (status) => ({
    value: status,
    label: TASK_STATUS_LABEL[status],
    leading: <TaskStatusMark status={status} />,
  }),
)
