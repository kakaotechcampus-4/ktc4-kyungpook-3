import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { retryTaskNotionSync, taskDetailQueryOptions, taskListQueryOptions } from '@/entities/task'
import type { Task } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { NOTION_SYNC_POLL_MS } from '../lib/notionSyncLabel'

/**
 * 태스크 상세 조회의 polling 간격. 반영 중(`pending`)인 동안만 3초마다 다시 묻는다.
 * 종료 상태(`synced`·`failed`·없음)이거나 조회가 실패했으면(접근 상실 포함) 멈춘다.
 * 화면을 떠나면 이 관찰자가 사라져 간격도 함께 사라진다
 */
export function notionSyncRefetchInterval(query: {
  state: { status: 'pending' | 'error' | 'success'; data: Task | undefined }
}): number | false {
  if (query.state.status === 'error') return false
  return query.state.data?.notionSyncStatus === 'pending' ? NOTION_SYNC_POLL_MS : false
}

/** Notion 재시도 mutation 의 key. 같은 태스크의 재시도를 한 번에 하나로 센다 */
export function notionRetryMutationKey(workspaceId: string, taskId: string) {
  return ['task-notion-retry', workspaceId, taskId] as const
}

interface RetryVariables {
  isCurrentSession: () => boolean
}

export interface TaskNotionSync {
  /** 지금 아는 그 태스크. 처음 조회 전에는 undefined 다 */
  task: Task | undefined
  /** 실패한 반영을 다시 요청한다. 진행 중이면 아무것도 하지 않는다 */
  retry: () => void
  retryPending: boolean
  /** 재시도가 성공해 서버가 돌려준 태스크. 반영 완료가 아니라 다시 대기열에 넣었다는 응답이다 */
  retried: Task | undefined
  retryError: Error | null
}

/**
 * 열린 화면의 태스크 Notion 반영 상태 (계획 §4-7, §4-8).
 * - 상세 조회와 같은 key 를 함께 관찰하고, 반영 중이면 3초마다 다시 조회한다
 * - 반영 실패면 PM 이 기존 재시도 API 를 부른다. 성공 응답(보통 `pending`)을 그 태스크 캐시에 쓰면 polling 이 다시 돈다.
 *   `반영됨` 은 그 뒤 조회가 `synced` 를 돌려줄 때만이다. 자동 재시도는 없다
 * - 요청 중 세션이 끝났으면 늦은 응답을 캐시에 쓰지 않는다
 */
export function useTaskNotionSync(workspaceId: string, taskId: string): TaskNotionSync {
  const queryClient = useQueryClient()
  const detail = useQuery({
    ...taskDetailQueryOptions(workspaceId, taskId),
    refetchInterval: notionSyncRefetchInterval,
  })
  const mutationKey = notionRetryMutationKey(workspaceId, taskId)
  const { mutate, isPending, data, error } = useMutation<Task, Error, RetryVariables>({
    mutationKey,
    retry: false,
    // 변수는 세션 경계(onSuccess)에서만 쓴다
    mutationFn: (): Promise<Task> => retryTaskNotionSync(workspaceId, taskId),
    onSuccess: (task, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      const newer = (current: Task) => (current.version > task.version ? current : task)
      queryClient.setQueryData(taskDetailQueryOptions(workspaceId, taskId).queryKey, (current) =>
        current === undefined ? task : newer(current),
      )
      queryClient.setQueryData(taskListQueryOptions(workspaceId).queryKey, (current) =>
        current?.map((item) => (item.id === task.id ? newer(item) : item)),
      )
    },
  })

  const retry = useCallback(() => {
    // 같은 틱의 두 번째 누름도 막는다
    if (queryClient.isMutating({ mutationKey: notionRetryMutationKey(workspaceId, taskId) }) > 0)
      return
    mutate({ isCurrentSession: captureSession() })
  }, [queryClient, mutate, workspaceId, taskId])

  return { task: detail.data, retry, retryPending: isPending, retried: data, retryError: error }
}
