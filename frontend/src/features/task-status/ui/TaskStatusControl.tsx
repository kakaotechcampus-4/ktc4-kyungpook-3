import type { TaskStatus } from '@/entities/task'
import { parseEnumParam } from '@/shared/lib/url'
import { Segmented, SegmentedItem } from '@/shared/ui/segmented'
import { TASK_STATUSES, TASK_STATUS_LABEL } from '../lib/statusLabel'
import { useTaskStatusChange } from '../model/useTaskStatusChange'

const BUSY = 'text-meta text-dim'

export interface TaskStatusControlProps {
  workspaceId: string
  taskId: string
  /** 지금 보이는 상태 — 진행 중인 변경이 있으면 그 값이다 */
  status: TaskStatus
}

/**
 * PM 의 상태 고르기 (E-5). 네 상태를 회색 트랙에 늘어놓고, 누르면 바로 바꾼다 — 상세의 저장 줄과 따로다.
 * 같은 태스크의 변경이 진행 중이면 잠긴다. 잠금은 화면을 떠났다 돌아와도 이어진다.
 */
export function TaskStatusControl({ workspaceId, taskId, status }: TaskStatusControlProps) {
  const { change, pending } = useTaskStatusChange(workspaceId, taskId)

  return (
    <div className="flex flex-col items-end gap-4">
      <Segmented
        aria-label="상태 바꾸기"
        size="md"
        value={status}
        aria-busy={pending}
        onValueChange={(value) => {
          const next = parseEnumParam(value, TASK_STATUSES)
          if (next !== null && next !== status) change(next)
        }}
      >
        {TASK_STATUSES.map((value) => (
          <SegmentedItem
            key={value}
            value={value}
            disabled={pending}
            // 팀원의 상태 배지와 같은 test id — 상세에 지금 보이는 상태다
            data-testid={value === status ? 'task-status' : undefined}
          >
            {TASK_STATUS_LABEL[value]}
          </SegmentedItem>
        ))}
      </Segmented>
      <span role="status" className={BUSY}>
        {pending ? '바꾸는 중이에요' : ''}
      </span>
    </div>
  )
}
