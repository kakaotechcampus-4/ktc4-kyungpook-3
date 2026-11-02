import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { createTask, taskListQueryOptions } from '@/entities/task'
import type { Task, TaskCreateInput } from '@/entities/task'
import { captureSession } from '@/entities/user'

/**
 * 직접 추가 mutation 의 key. 셋째 칸이 상태라 보드 칸마다 진행 중 요청을 따로 센다.
 * 공간까지만 주면 그 공간의 모든 직접 추가와 부분 일치한다
 */
export function taskCreateMutationKey(workspaceId: string, status?: Task['status']) {
  return status === undefined
    ? (['task-create', workspaceId] as const)
    : (['task-create', workspaceId, status] as const)
}

interface CreateVariables extends TaskCreateInput {
  /** 요청을 시작한 세션이 아직 이어지는지. 끝났으면 캐시에 아무것도 쓰지 않는다 */
  isCurrentSession: () => boolean
}

export interface TaskCreate {
  /** 만든다. 이 칸의 요청이 진행 중이면 아무것도 하지 않는다. 서버가 만든 태스크로 끝나면 `onCreated` 를 부른다 */
  create: (input: TaskCreateInput, onCreated: (task: Task) => void) => void
  pending: boolean
  /** 마지막 요청의 실패. 다시 보내거나 `reset` 하면 사라진다 */
  error: Error | null
  reset: () => void
}

/**
 * PM 의 태스크 직접 추가 (M8 A 보완, 보드 `직접 추가`). 낙관적으로 그리지 않는다 — 서버가 만든 태스크만 목록 캐시에 넣고,
 * 목록을 다시 받아 서버와 맞춘다. 실패하면 캐시는 그대로이고 `error` 로 알린다.
 * 같은 칸의 요청은 한 번에 하나다. mutation 캐시로 세어 같은 틱의 두 번째 제출도 막는다.
 */
export function useTaskCreate(workspaceId: string, status: Task['status']): TaskCreate {
  const queryClient = useQueryClient()
  const mutationKey = taskCreateMutationKey(workspaceId, status)
  const { mutate, isPending, error, reset } = useMutation({
    mutationKey,
    mutationFn: ({ title, status: next, assigneeMemberId }: CreateVariables) =>
      createTask(workspaceId, { title, status: next, assigneeMemberId }),
    onSuccess: (task, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      const { queryKey } = taskListQueryOptions(workspaceId)
      queryClient.setQueryData(queryKey, (current) =>
        current === undefined || current.some(({ id }) => id === task.id)
          ? current
          : [...current, task],
      )
      void queryClient.invalidateQueries({ queryKey, exact: true })
    },
  })

  const create = useCallback(
    (input: TaskCreateInput, onCreated: (task: Task) => void) => {
      if (queryClient.isMutating({ mutationKey: taskCreateMutationKey(workspaceId, status) }) > 0)
        return
      mutate({ ...input, isCurrentSession: captureSession() }, { onSuccess: onCreated })
    },
    [queryClient, mutate, workspaceId, status],
  )

  return { create, pending: isPending, error, reset }
}
