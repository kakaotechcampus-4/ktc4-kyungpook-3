import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import type { RequestOptions } from '@/shared/api/client'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { createInvalidResponseError, parseResponse } from '@/shared/api/parseResponse'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { timelineListSchema } from '@/shared/types/api/reply'
import type { TaskDto } from '@/shared/types/api/task'
import { taskHistoryListSchema, taskListSchema, taskSchema } from '@/shared/types/api/task'
import { toTask, toTaskHistory, toTaskTimeline } from '../model/mapper'
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

/** 태스크 하나를 돌려주는 경로(조회·변경·생성·되돌리기) 모두 같은 스키마와 공간 확인을 거친다 */
async function requestTask(
  workspaceId: string,
  path: string,
  options?: RequestOptions,
): Promise<Task> {
  const data = await request<unknown>(path, options)
  return toWorkspaceTask(parseResponse(taskSchema, data, 'task'), workspaceId)
}

/** 공간의 태스크 전체. 서버가 마감 오름차순·생성 내림차순으로 준다 (backend tasks.py list_tasks) */
export async function fetchTaskList(workspaceId: string, signal?: AbortSignal): Promise<Task[]> {
  const { items } = parseResponse(
    taskListSchema,
    await request<unknown>('/tasks', { params: { workspace_id: workspaceId }, signal }),
    'task',
  )
  return items.map((dto) => toWorkspaceTask(dto, workspaceId))
}

/** 태스크 단건. 응답의 `workspace_id` 가 요청한 공간과 다르면 던진다 */
export async function fetchTask(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<Task> {
  return requestTask(workspaceId, `/tasks/${encodeURIComponent(taskId)}`, { signal })
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

/** 서버가 돌려준 태스크를 그 태스크의 목록 행·상세 캐시에 쓴다. 다른 태스크와 없는 캐시는 건드리지 않는다 */
export function writeServerTask(queryClient: QueryClient, workspaceId: string, task: Task): void {
  const newer = (current: Task) => (current.version > task.version ? current : task)
  queryClient.setQueryData(taskDetailQueryOptions(workspaceId, task.id).queryKey, (current) =>
    current === undefined ? undefined : newer(current),
  )
  queryClient.setQueryData(taskListQueryOptions(workspaceId).queryKey, (current) =>
    current?.map((item) => (item.id === task.id ? newer(item) : item)),
  )
}

/**
 * 태스크 상세의 변경 이력. 최신순이다. 답장은 그 답장이 바꾼 값과 한 칸으로 묶이고, 답장에 이어진 이력은 따로 나오지 않는다
 * (`/timeline`). 타임라인의 이력 칸에는 변경자·되돌림이 없어서 `/history` 를 함께 받아 채운다. 상태 변경·승인이 이 key 를
 * 정확히 무효화하므로 두 응답을 이 key 하나에 둔다.
 * 이력 응답에는 공간이 없어서, 같은 태스크의 상세(공간을 확인한 캐시)를 함께 확보한다 — 상세가 캐시에 있으면 다시 요청하지 않는다.
 * 모든 이력의 `task_id` 가 요청한 태스크인지도 본다. 어느 하나라도 어긋나면 성공 데이터가 아니다
 */
export function taskHistoryQueryOptions(workspaceId: string, taskId: string) {
  const path = `/tasks/${encodeURIComponent(taskId)}`
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'tasks', 'history', taskId),
    queryFn: async ({ signal, client }) => {
      const [, historyData, timelineData] = await Promise.all([
        client.ensureQueryData(taskDetailQueryOptions(workspaceId, taskId)),
        request<unknown>(`${path}/history`, { signal }),
        request<unknown>(`${path}/timeline`, { signal }),
      ])
      const history = parseResponse(taskHistoryListSchema, historyData, 'task history')
      const timeline = parseResponse(timelineListSchema, timelineData, 'task timeline')
      const stray = history.items.findIndex((dto) => dto.task_id !== taskId)
      if (stray !== -1) throw createInvalidResponseError('task history', `items[${stray}].task_id`)
      return toTaskTimeline(timeline.items, history.items.map(toTaskHistory), taskId)
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
  return requestTask(workspaceId, `/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: { status },
  })
}

/** 상세에서 고치는 담당자·마감. 있는 키만 보낸다. null 은 비우기다 */
export type TaskFieldsPatch = Partial<Pick<Task, 'assigneeMemberId' | 'dueDate'>>

/**
 * PM 의 담당자·마감 변경 (`PATCH /tasks/{task_id}`, PM 전용). 서버는 보낸 키만 바꾸고(`exclude_unset`) 버전을 비교하지 않아
 * 나중에 저장한 값이 남는다. 변경자는 보내지 않는다 — 서버가 세션의 팀원으로 기록한다. 서버가 돌려준 태스크의 공간을 확인한다
 */
export async function updateTaskFields(
  workspaceId: string,
  taskId: string,
  patch: TaskFieldsPatch,
  init: { signal?: AbortSignal } = {},
): Promise<Task> {
  return requestTask(workspaceId, `/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: {
      ...('assigneeMemberId' in patch ? { assignee_member_id: patch.assigneeMemberId } : {}),
      ...('dueDate' in patch ? { due_date: patch.dueDate } : {}),
    },
    signal: init.signal,
  })
}

export interface TaskCreateInput {
  title: string
  status: TaskStatus
  assigneeMemberId: string | null
}

/**
 * PM 의 태스크 직접 생성 (`POST /tasks`, 계약 §2.6, 서버는 PM 전용). 생성자(`created_by`)는 보내지 않는다 —
 * 서버가 세션의 팀원으로 기록한다. 담당자가 없으면 그 필드를 보내지 않는다. 서버가 돌려준 태스크의 공간을 확인한다
 */
export async function createTask(workspaceId: string, input: TaskCreateInput): Promise<Task> {
  return requestTask(workspaceId, '/tasks', {
    method: 'POST',
    body: {
      workspace_id: workspaceId,
      title: input.title,
      status: input.status,
      ...(input.assigneeMemberId === null ? {} : { assignee_member_id: input.assigneeMemberId }),
    },
  })
}

/**
 * Notion 반영 실패를 다시 대기열에 넣는다 (`POST /tasks/{task_id}/notion-sync/retry`, PM 전용).
 * 본문이 없다. 돌아온 상태는 보통 `pending` 이며, 반영 완료는 이후 조회의 `synced` 로만 판단한다
 */
export async function retryTaskNotionSync(workspaceId: string, taskId: string): Promise<Task> {
  return requestTask(workspaceId, `/tasks/${encodeURIComponent(taskId)}/notion-sync/retry`, {
    method: 'POST',
  })
}

/**
 * 무응답 자동 막힘 풀기. PM 전용이다. 상태와 사유가 막히기 전 값으로 돌아간다. 돌려받은 태스크의 `autoBlocked` 는 false 다.
 * 지금 풀 수 없으면(`autoBlocked` 가 false 인 상태) 409 다
 */
export async function undoTaskAutoBlock(
  workspaceId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<Task> {
  return requestTask(workspaceId, `/tasks/${encodeURIComponent(taskId)}/auto-block/undo`, {
    method: 'POST',
    signal,
  })
}

/**
 * 답장이 자동 반영한 값을 되돌린다. PM 전용이다. 이어진 이력이 그 뒤 바뀌었거나 되돌릴 수 없는 줄이면 409
 * `REPLY_CHANGE_NOT_UNDOABLE` 이고 아무것도 바뀌지 않는다
 */
export async function undoReplyChange(
  workspaceId: string,
  taskId: string,
  changeId: string,
  signal?: AbortSignal,
): Promise<Task> {
  return requestTask(
    workspaceId,
    `/tasks/${encodeURIComponent(taskId)}/reply-changes/${encodeURIComponent(changeId)}/undo`,
    { method: 'POST', signal },
  )
}
