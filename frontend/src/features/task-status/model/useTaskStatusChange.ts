import { useIsMutating, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import {
  taskDetailQueryOptions,
  taskHistoryQueryOptions,
  taskListQueryOptions,
  updateTaskStatus,
} from '@/entities/task'
import type { Task, TaskStatus } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { findMemberWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import { failureNotice } from '@/shared/api/errorMessages'
import { paths } from '@/shared/config/routes'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { toast } from '@/shared/ui/toast'

/** 상태 변경 실패 알림의 제목. 이 기능 전용 문구다 */
export const TASK_STATUS_FAILED_TITLE = '상태를 바꾸지 못했어요'

/**
 * 상태 변경 mutation 의 key. 셋째 칸이 태스크라 같은 태스크의 진행 중 요청을 따로 셀 수 있다.
 * 공간까지만 주면 그 공간의 모든 상태 변경과 부분 일치한다 (TanStack 의 mutationKey 부분 일치)
 */
export function taskStatusMutationKey(workspaceId: string, taskId?: string) {
  return taskId === undefined
    ? (['task-status', workspaceId] as const)
    : (['task-status', workspaceId, taskId] as const)
}

interface StatusVariables {
  taskId: string
  status: TaskStatus
  /** 요청을 시작한 세션이 아직 이어지는지. 끝났으면 화면·캐시·알림에 아무것도 남기지 않는다 */
  isCurrentSession: () => boolean
}

/**
 * 진행 중인 상태 변경을 화면에 겹쳐 보이는 값. 태스크 ID → 바꾸려는 상태.
 *
 * 낙관적 반영을 캐시에 쓰지 않고 진행 중 mutation 의 변수로 그린다. 그래서
 * - 실패하면 그 태스크의 겹침만 사라진다 — 목록 스냅샷을 되돌리지 않아 다른 태스크의 동시 변경이 그대로다.
 * - 진행 중에 목록을 다시 받아도(포커스·무효화) 겹침이 남는다 — 이전 서버 값이 낙관적 값을 덮지 않는다.
 * 끝난 세션에서 시작한 변경은 겹치지 않는다 — 다음 사용자의 화면에 이전 사용자의 변경이 보이지 않는다.
 */
export function useTaskStatusOverlay(workspaceId: string): ReadonlyMap<string, TaskStatus> {
  const pending = useMutationState({
    filters: { mutationKey: taskStatusMutationKey(workspaceId), status: 'pending' },
    select: (mutation) => mutation.state.variables as StatusVariables | undefined,
  })
  return useMemo(
    () =>
      new Map(
        pending.flatMap((variables) =>
          variables !== undefined && variables.isCurrentSession()
            ? [[variables.taskId, variables.status] as const]
            : [],
        ),
      ),
    [pending],
  )
}

/** 서버가 돌려준 태스크를 그 태스크의 목록 행·상세 캐시에 쓴다. 다른 태스크와 없는 캐시는 건드리지 않는다 */
function writeServerTask(queryClient: QueryClient, workspaceId: string, task: Task): void {
  // 이미 더 새 버전을 받았으면 그대로 둔다
  const newer = (current: Task) => (current.version > task.version ? current : task)
  queryClient.setQueryData(taskDetailQueryOptions(workspaceId, task.id).queryKey, (current) =>
    current === undefined ? undefined : newer(current),
  )
  queryClient.setQueryData(taskListQueryOptions(workspaceId).queryKey, (current) =>
    current?.map((item) => (item.id === task.id ? newer(item) : item)),
  )
}

/**
 * 그 태스크의 목록·상세·이력을 서버 값으로 다시 맞춘다. 진행 중이던 이전 조회는 거두고 새로 묻는다
 * (무효화의 `cancelRefetch`) — 변경 전 서버 상태의 답이 늦게 와서 덮지 않는다. 지금 그리지 않는 캐시는 낡음 표시만 한다
 */
function syncTask(queryClient: QueryClient, workspaceId: string, taskId: string): void {
  for (const { queryKey } of [
    taskListQueryOptions(workspaceId),
    taskDetailQueryOptions(workspaceId, taskId),
    taskHistoryQueryOptions(workspaceId, taskId),
  ])
    void queryClient.invalidateQueries({ queryKey, exact: true })
}

function isPmNow(queryClient: QueryClient, workspaceId: string): boolean {
  const workspaces = queryClient.getQueryData(workspaceListQueryOptions().queryKey)
  return findMemberWorkspace(workspaces ?? [], workspaceId)?.role === 'pm'
}

export interface TaskStatusChange {
  /** 상태를 바꾼다. 같은 태스크의 요청이 진행 중이면 아무것도 하지 않는다 */
  change: (status: TaskStatus) => void
  /** 이 태스크의 상태 변경이 진행 중이다. 화면을 떠났다 돌아와도 이어진다 */
  pending: boolean
}

/**
 * PM 의 태스크 상태 변경 (계획 §3-6, §3-7). 상태 하나만 바꾸고, 진행 중에는 `useTaskStatusOverlay` 로 목록·상세에 먼저 보인다.
 *
 * - 같은 태스크는 한 번에 하나다. 진행 여부는 mutation 캐시로 센다 — 화면을 다시 마운트해도, 같은 틱의 두 번째 입력도 막는다.
 * - 성공하면 돌려받은 태스크를 그 태스크 캐시에 쓰고, 실패하면 겹침이 사라져 그 태스크만 이전 값으로 돌아온다.
 *   실패 알림 뒤 그 태스크의 목록·상세·이력을 다시 받는다. 성공도 같이 다시 받아 이력까지 서버와 맞춘다.
 * - 요청 중 세션이 끝났으면(로그아웃·만료) 늦은 응답은 캐시·알림을 만들지 않는다. 이 공간의 태스크 화면을 떠났거나 PM 이 아니게
 *   됐으면 알림을 띄우지 않는다 — 그 공간의 캐시는 공간 key 라 다른 공간 화면에 섞이지 않는다.
 */
export function useTaskStatusChange(workspaceId: string, taskId: string): TaskStatusChange {
  const queryClient = useQueryClient()
  const livePathname = useLivePathname()
  const mutationKey = taskStatusMutationKey(workspaceId, taskId)
  const pending = useIsMutating({ mutationKey }) > 0
  const tasksPath = paths.tasks(workspaceId)

  const { mutate } = useMutation({
    mutationKey,
    mutationFn: (variables: StatusVariables) =>
      updateTaskStatus(workspaceId, variables.taskId, variables.status),
    onSuccess: (task, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      writeServerTask(queryClient, workspaceId, task)
      syncTask(queryClient, workspaceId, taskId)
    },
    onError: (error, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      const notice = failureNotice(error)
      // 알림은 아직 이 공간의 태스크 화면에 있을 때만 — 다른 공간·다른 화면에 이전 화면의 실패를 띄우지 않는다
      const here = livePathname()
      const stillHere = here === tasksPath || here.startsWith(`${tasksPath}/`)
      if (notice !== null && stillHere && isPmNow(queryClient, workspaceId))
        toast.show({
          key: `task-status-${taskId}`,
          title: TASK_STATUS_FAILED_TITLE,
          description: notice,
        })
      syncTask(queryClient, workspaceId, taskId)
    },
  })

  const change = useCallback(
    (status: TaskStatus) => {
      // 같은 틱의 두 번째 입력도 막는다. mutation 은 시작하는 순간 캐시에서 진행 중이다
      if (queryClient.isMutating({ mutationKey: taskStatusMutationKey(workspaceId, taskId) }) > 0)
        return
      mutate({ taskId, status, isCurrentSession: captureSession() })
    },
    [queryClient, mutate, workspaceId, taskId],
  )

  return { change, pending }
}
