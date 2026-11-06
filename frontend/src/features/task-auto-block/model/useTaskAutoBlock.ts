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
  session: SessionScope
}

export interface TaskAutoBlock {
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
      // 목록은 스케줄러와 잠금 없이 읽어서 보여 준 값이 낡았을 수 있다
      if (isStale(error)) void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: AUTO_BLOCK_UNDO_FAILED, description: errorMessage(error) })
    },
  })
  const undo = useCallback(() => {
    if (!isPending) mutate({ session: captureSessionScope() })
  }, [isPending, mutate])

  return { automatic: task.autoBlocked, undo, undoPending: isPending }
}
