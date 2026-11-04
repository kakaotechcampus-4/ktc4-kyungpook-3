import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  isAutoBlocked,
  taskDetailQueryOptions,
  taskHistoryQueryOptions,
  taskKeys,
  undoTaskAutoBlock,
} from '@/entities/task'
import type { Task } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { toast } from '@/shared/ui/toast'

export const AUTO_BLOCK_UNDONE = '자동 막힘을 풀었어요'
export const AUTO_BLOCK_UNDO_FAILED = '막힘을 풀지 못했어요'

interface UndoVariables {
  isCurrentSession: () => boolean
}

export interface TaskAutoBlock {
  /** 무응답 자동 막힘인가. 이력을 받기 전이거나 받지 못했으면 false 다 */
  automatic: boolean
  /** 막힌 태스크의 이력을 받지 못했다 */
  historyFailed: boolean
  retryHistory: () => void
  undo: () => void
  undoPending: boolean
}

function isStale(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === ERROR_CODES.AUTO_BLOCK_NOT_FOUND
  )
}

/**
 * 무응답 자동 막힘과 그 풀기 (#330). 막힌 태스크만 이력을 받아 가린다 — 막힘 사유 문구로 가르지 않는다.
 * 409 `AUTO_BLOCK_NOT_FOUND` 는 막힌 뒤 값이 바뀐 것이라 태스크와 이력을 다시 받는다
 */
export function useTaskAutoBlock(workspaceId: string, task: Task): TaskAutoBlock {
  const queryClient = useQueryClient()
  const blocked = task.status === 'blocked'
  const history = useQuery({ ...taskHistoryQueryOptions(workspaceId, task.id), enabled: blocked })
  const { mutate, isPending } = useMutation<Task, Error, UndoVariables>({
    // 변수는 세션 경계(onSuccess·onError)에서만 쓴다
    mutationFn: () => undoTaskAutoBlock(workspaceId, task.id),
    onSuccess: (updated, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      queryClient.setQueryData(taskDetailQueryOptions(workspaceId, task.id).queryKey, updated)
      void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: AUTO_BLOCK_UNDONE })
    },
    onError: (error, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      if (isStale(error)) void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: AUTO_BLOCK_UNDO_FAILED, description: errorMessage(error) })
    },
  })
  const undo = useCallback(() => {
    if (!isPending) mutate({ isCurrentSession: captureSession() })
  }, [isPending, mutate])
  const { refetch } = history
  const retryHistory = useCallback(() => void refetch(), [refetch])

  return {
    automatic: blocked && history.data !== undefined && isAutoBlocked(task, history.data),
    historyFailed: blocked && history.isError && history.data === undefined,
    retryHistory,
    undo,
    undoPending: isPending,
  }
}
