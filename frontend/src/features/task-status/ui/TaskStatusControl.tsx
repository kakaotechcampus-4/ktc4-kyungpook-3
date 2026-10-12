import { useId } from 'react'
import type { TaskStatus } from '@/entities/task'
import { parseEnumParam } from '@/shared/lib/url'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../lib/statusLabel'
import { useTaskStatusChange } from '../model/useTaskStatusChange'

const ROOT = 'flex items-center gap-10'
const LABEL = 'text-caption font-semibold text-dim'
const SELECT =
  'h-32 rounded-9 border border-line bg-surface px-10 text-control text-ink hover:border-line-strong disabled:text-faint'
const BUSY = 'text-meta text-dim'

export interface TaskStatusControlProps {
  workspaceId: string
  taskId: string
  /** 지금 보이는 상태 — 진행 중인 변경이 있으면 그 값이다 */
  status: TaskStatus
}

/**
 * PM 의 상태 고르기. 상태만 바꾼다 — 다른 필드 편집은 없다 (계획 §3-5).
 * 같은 태스크의 변경이 진행 중이면 잠긴다. 잠금은 화면을 떠났다 돌아와도 이어진다.
 */
export function TaskStatusControl({ workspaceId, taskId, status }: TaskStatusControlProps) {
  const id = useId()
  const { change, pending } = useTaskStatusChange(workspaceId, taskId)

  return (
    <div className={ROOT}>
      <label htmlFor={id} className={LABEL}>
        상태 바꾸기
      </label>
      <select
        id={id}
        className={SELECT}
        value={status}
        disabled={pending}
        aria-busy={pending}
        onChange={(event) => {
          const next = parseEnumParam(event.target.value, TASK_STATUSES)
          if (next !== null && next !== status) change(next)
        }}
      >
        {TASK_STATUSES.map((value) => (
          <option key={value} value={value}>
            {TASK_STATUS_LABEL[value]}
          </option>
        ))}
      </select>
      <span role="status" className={BUSY}>
        {pending ? '바꾸는 중이에요' : ''}
      </span>
    </div>
  )
}
