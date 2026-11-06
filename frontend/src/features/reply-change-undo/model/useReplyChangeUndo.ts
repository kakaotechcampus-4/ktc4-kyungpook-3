import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { taskKeys, undoReplyChange, writeServerTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, CLIENT_ERROR_CODES, ERROR_CODES, createClientError } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { toast } from '@/shared/ui/toast'

export const REPLY_CHANGE_UNDONE = '답장으로 바꾼 값을 되돌렸어요'
export const REPLY_CHANGE_UNDO_FAILED = '되돌리지 못했어요'

interface UndoVariables {
  changeId: string
  session: SessionScope
}

export interface ReplyChangeUndo {
  undo: (changeId: string) => void
  /** 되돌리는 중인 줄. 한 번에 하나만 보낸다 */
  pendingChangeId: string | null
}

function isStale(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === ERROR_CODES.REPLY_CHANGE_NOT_UNDOABLE
  )
}

export function useReplyChangeUndo(workspaceId: string, taskId: string): ReplyChangeUndo {
  const queryClient = useQueryClient()
  const { mutate, isPending, variables } = useMutation<Task, Error, UndoVariables>({
    mutationFn: ({ changeId, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return undoReplyChange(workspaceId, taskId, changeId, session.signal)
    },
    onSuccess: (updated, { session }) => {
      if (!session.isCurrent()) return
      writeServerTask(queryClient, workspaceId, updated)
      void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: REPLY_CHANGE_UNDONE })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      // 보여 준 기록이 낡았다. 그 뒤 다른 변경이 있었거나 이미 되돌렸다
      if (isStale(error)) void queryClient.invalidateQueries({ queryKey: taskKeys(workspaceId) })
      toast.show({ title: REPLY_CHANGE_UNDO_FAILED, description: errorMessage(error) })
    },
  })
  const undo = useCallback(
    (changeId: string) => {
      if (!isPending) mutate({ changeId, session: captureSessionScope() })
    },
    [isPending, mutate],
  )

  return { undo, pendingChangeId: isPending ? (variables?.changeId ?? null) : null }
}
