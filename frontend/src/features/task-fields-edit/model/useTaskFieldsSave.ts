import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import {
  showTaskWriteUnconfirmed,
  taskDetailQueryOptions,
  taskHistoryQueryOptions,
  taskListQueryOptions,
  updateTaskFields,
  writeServerTask,
} from '@/entities/task'
import type { Task, TaskFieldsPatch } from '@/entities/task'
import { failureNotice } from '@/shared/api/errorMessages'
import { CLIENT_ERROR_CODES, createClientError, isInvalidResponse } from '@/shared/api/errors'
import { captureSessionScope } from '@/shared/api/sessionScope'
import type { SessionScope } from '@/shared/api/sessionScope'
import { toTaskFieldsPatch } from './draft'
import type { TaskFieldChange } from './draft'

export interface TaskFieldsSave {
  /** 바뀐 값만 저장한다. 바뀐 것이 없거나 저장 중이면 아무것도 하지 않는다 */
  save: (changes: readonly TaskFieldChange[], onSaved?: (task: Task) => void) => void
  pending: boolean
  /** 저장 줄에 보일 실패 문구. 다음 저장이나 `clearError` 로 지운다 */
  errorMessage: string | null
  clearError: () => void
}

const mutationKeyOf = (workspaceId: string, taskId: string) =>
  ['task-fields', workspaceId, taskId] as const

interface Variables {
  patch: TaskFieldsPatch
  /** 저장을 누른 세션. 끝났으면 보내지 않고, 보낸 요청은 취소하며, 화면·캐시에 아무것도 남기지 않는다 */
  session: SessionScope
}

/**
 * 태스크 상세의 담당자·마감 저장 (E-5). 서버가 버전을 비교하지 않아 나중에 저장한 값이 남는다 — 앱의 다른 저장과 같다.
 * - 성공하면 돌려받은 태스크를 캐시에 쓰고 그 태스크의 목록·상세·이력을 다시 받는다
 * - 실패하면 캐시는 그대로 두고 문구만 남긴다. 고친 값은 부른 쪽이 그대로 들고 있다. 알림은 띄우지 않는다
 */
export function useTaskFieldsSave(workspaceId: string, taskId: string): TaskFieldsSave {
  const queryClient = useQueryClient()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { mutate, isPending } = useMutation<Task, Error, Variables>({
    mutationKey: mutationKeyOf(workspaceId, taskId),
    retry: false,
    mutationFn: ({ patch, session }) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return updateTaskFields(workspaceId, taskId, patch, { signal: session.signal })
    },
    onSuccess: (task, { session }) => {
      if (!session.isCurrent()) return
      writeServerTask(queryClient, workspaceId, task)
      for (const { queryKey } of [
        taskListQueryOptions(workspaceId),
        taskDetailQueryOptions(workspaceId, taskId),
        taskHistoryQueryOptions(workspaceId, taskId),
      ])
        void queryClient.invalidateQueries({ queryKey, exact: true })
    },
    onError: (error, { session }) => {
      if (!session.isCurrent()) return
      if (isInvalidResponse(error)) showTaskWriteUnconfirmed(queryClient, workspaceId)
      else setErrorMessage(failureNotice(error))
    },
  })

  const save = useCallback(
    (changes: readonly TaskFieldChange[], onSaved?: (task: Task) => void) => {
      if (changes.length === 0) return
      // 같은 틱의 두 번째 누름도 막는다 — 렌더 전의 isPending 은 아직 false 다
      if (queryClient.isMutating({ mutationKey: mutationKeyOf(workspaceId, taskId) }) > 0) return
      setErrorMessage(null)
      const session = captureSessionScope()
      mutate(
        { patch: toTaskFieldsPatch(changes), session },
        {
          onSuccess: (task) => {
            if (session.isCurrent()) onSaved?.(task)
          },
        },
      )
    },
    [queryClient, mutate, workspaceId, taskId],
  )

  const clearError = useCallback(() => setErrorMessage(null), [])

  return { save, pending: isPending, errorMessage, clearError }
}
