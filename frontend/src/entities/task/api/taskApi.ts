import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { ApiError, CLIENT_ERROR_CODES, ERROR_CODES, createClientError } from '@/shared/api/errors'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { toTask, toTaskHistory } from '../model/mapper'
import type { Task, TaskStatus } from '../model/types'

/** 태스크 캐시 전체의 접두어. 목록·상세·이력이 함께 쓴다 — 무효화는 이 key 하나로 끝난다 */
export function taskKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'tasks')
}

/**
 * 응답이 요청한 공간의 것인지 본다. 단건 경로(`/tasks/{task_id}`)에는 공간이 없어서, 다른 공간의 태스크가
 * 이 공간의 key 로 캐시에 들어갈 수 있다. 어긋나면 성공 데이터로 돌려주지 않고 던진다.
 * 서버 응답이 아니라 클라이언트 판정이라 kind 는 `invalid_response` 다 — 재시도하지 않는다
 */
function assertWorkspace(dto: Pick<TaskDto, 'workspace_id'>, workspaceId: string): void {
  if (dto.workspace_id === workspaceId) return
  throw new ApiError(
    {
      code: ERROR_CODES.WORKSPACE_MISMATCH,
      message: 'task response belongs to another workspace',
      details: { requested_workspace_id: workspaceId, response_workspace_id: dto.workspace_id },
    },
    0,
    'invalid_response',
  )
}

function toWorkspaceTask(dto: TaskDto, workspaceId: string): Task {
  assertWorkspace(dto, workspaceId)
  return toTask(dto)
}

/** 공간의 태스크 전체. 서버가 마감 오름차순·생성 내림차순으로 준다 (backend tasks.py list_tasks) */
export async function fetchTaskList(workspaceId: string, signal?: AbortSignal): Promise<Task[]> {
  const { items } = await request<ListDto<TaskDto>>('/tasks', {
    params: { workspace_id: workspaceId },
    signal,
  })
  return items.map((dto) => toWorkspaceTask(dto, workspaceId))
}

/** 태스크 단건. 응답의 `workspace_id` 가 요청한 공간과 다르면 던진다 */
export async function fetchTask(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<Task> {
  return toWorkspaceTask(
    await request<TaskDto>(`/tasks/${encodeURIComponent(taskId)}`, { signal }),
    workspaceId,
  )
}

/** 태스크 목록. 기본 최신 시간(30초)이다 */
export function taskListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'tasks', 'list'),
    queryFn: ({ signal }) => fetchTaskList(workspaceId, signal),
    staleTime: STALE_TIME.default,
  })
}

/** 태스크 상세. 경로에 공간이 없어 key 에 요청한 화면의 공간을 넣고, 응답 공간을 확인한다 */
export function taskDetailQueryOptions(workspaceId: string, taskId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'tasks', 'detail', taskId),
    queryFn: ({ signal }) => fetchTask(workspaceId, taskId, signal),
  })
}

/**
 * 태스크 변경 이력. 최신순으로 온다. 이력 응답에는 공간이 없어서, 같은 태스크의 상세(공간을 확인한 캐시)를
 * 함께 확보한다 — 상세가 캐시에 있으면 다시 요청하지 않는다. 모든 이력의 `task_id` 가 요청한 태스크인지도 본다.
 * 어느 하나라도 어긋나면 성공 데이터가 아니다
 */
export function taskHistoryQueryOptions(workspaceId: string, taskId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'tasks', 'history', taskId),
    queryFn: async ({ signal, client }) => {
      const [, { items }] = await Promise.all([
        client.ensureQueryData(taskDetailQueryOptions(workspaceId, taskId)),
        request<ListDto<TaskHistoryDto>>(`/tasks/${encodeURIComponent(taskId)}/history`, {
          signal,
        }),
      ])
      if (items.some((dto) => dto.task_id !== taskId))
        throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
      return items.map(toTaskHistory)
    },
  })
}

/**
 * PM 의 상태 변경 (`PATCH /tasks/{task_id}`). 본문은 상태 하나다. 변경자(`changed_by`)는 보내지 않는다 —
 * 서버가 세션의 팀원으로 기록한다. 서버가 돌려준 태스크의 공간을 확인한다
 */
export async function updateTaskStatus(
  workspaceId: string,
  taskId: string,
  status: TaskStatus,
): Promise<Task> {
  return toWorkspaceTask(
    await request<TaskDto>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: { status },
    }),
    workspaceId,
  )
}

/**
 * Notion 반영 실패를 다시 대기열에 넣는다 (`POST /tasks/{task_id}/notion-sync/retry`, PM 전용).
 * 본문이 없다. 돌아온 상태는 보통 `pending` 이며, 반영 완료는 이후 조회의 `synced` 로만 판단한다
 */
export async function retryTaskNotionSync(workspaceId: string, taskId: string): Promise<Task> {
  return toWorkspaceTask(
    await request<TaskDto>(`/tasks/${encodeURIComponent(taskId)}/notion-sync/retry`, {
      method: 'POST',
    }),
    workspaceId,
  )
}
