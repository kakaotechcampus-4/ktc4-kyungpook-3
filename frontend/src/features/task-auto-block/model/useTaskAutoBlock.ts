import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { taskKeys, undoTaskAutoBlock, writeServerTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, CLIENT_ERROR_CODES, ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { toast } from '@/shared/ui/toast'

export const AUTO_BLOCK_UNDONE = '자동 막힘을 풀었어요'
export const AUTO_BLOCK_UNDO_FAILED = '막힘을 풀지 못했어요'

interface UndoVariables {
  /** 풀기를 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 캐시·알림에 아무것도 남기지 않는다 */
  session: SessionScope
}

export interface TaskAutoBlock {
  /** 무응답 자동 막힘이고 지금 풀 수 있다. 서버의 `auto_blocked` 다 */
  automatic: boolean
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
 * 무응답 자동 막힘과 그 풀기 (#330, #365). 판정은 태스크 응답의 `auto_blocked` 하나라 따로 조회하지 않는다.
 * 풀면 돌려받은 태스크를 목록·상세 캐시에 바로 쓰고 다시 받는다.
 * 409 `AUTO_BLOCK_NOT_FOUND` 는 보여 준 값이 낡은 것이라(목록은 스케줄러와 잠금 없이 읽는다) 태스크를 다시 받는다
 */
export function useTaskAutoBlock(workspaceId: string, task: Task): TaskAutoBlock {
  const queryClient = useQueryClient()
  const { mutate, isPending } = useMutation<Task, Error, UndoVariables>({
    mutationFn: ({ session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return undoTaskAutoBlock(workspaceId, task.id, session.signal)
    },
    onSuccess: (updated, { session }) => {
      if (!session.isCurrent()) return
      writeServerTask(queryClient, workspaceId, updated)
      void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: AUTO_BLOCK_UNDONE })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      if (isStale(error)) void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: AUTO_BLOCK_UNDO_FAILED, description: errorMessage(error) })
    },
  })
  const undo = useCallback(() => {
    if (!isPending) mutate({ session: captureSessionScope() })
  }, [isPending, mutate])

  return { automatic: task.autoBlocked, undo, undoPending: isPending }
}
