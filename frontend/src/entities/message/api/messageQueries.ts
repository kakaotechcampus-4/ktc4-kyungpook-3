import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type {
  BundleApproveRequestDto,
  BundleDto,
  BundleUpdateRequestDto,
  InboxDto,
  ReplyCreateRequestDto,
  ThreadDetailDto,
} from '@/shared/types/api/message'
import { toBundle, toMessageInbox, toMessageThread } from '../model/mapper'
import type { MessageAction, MessageActionOutcome } from '../model/types'

/*
 * 메시지 조회와 쓰기 (계약 §5.7). 상태 동기화(polling)는 두지 않는다 (D-136) — 행동이 성공하면 아래 key 를 무효화해 다시 받는다
 */

function messagesPath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/messages`
}

/** 그 공간의 메시지 캐시 전체(목록·대화). 행동이 성공하면 이 key 를 무효화한다 */
export function messageKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'messages')
}

/** 왼쪽 목록 — 보낼 메시지(PM 만)와 대화 요약 */
export function messageInboxQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'inbox'),
    queryFn: async ({ signal }) =>
      toMessageInbox(await request<InboxDto>(messagesPath(workspaceId), { signal })),
  })
}

/** 대화 하나. 목록과 따로 받는다 — 한쪽 오류가 다른 쪽을 막지 않는다 (계획 C-6 5단계) */
export function messageThreadQueryOptions(workspaceId: string, threadId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'threads', threadId),
    queryFn: async ({ signal }) =>
      toMessageThread(
        await request<ThreadDetailDto>(
          `${messagesPath(workspaceId)}/threads/${encodeURIComponent(threadId)}`,
          { signal },
        ),
      ),
  })
}

function enc(id: string): string {
  return encodeURIComponent(id)
}

interface Route {
  method: 'POST' | 'PATCH'
  path: string
  body?: unknown
}

/** 행동 종류마다 경로가 하나다. 종류를 더하면 이 표가 빠져 빌드가 깨진다 */
const ROUTE: {
  [K in MessageAction['kind']]: (action: Extract<MessageAction, { kind: K }>) => Route
} = {
  approve: (action) => ({
    method: 'POST',
    path: `bundles/${enc(action.bundleId)}/approve`,
    body: { draft_version: action.draftVersion } satisfies BundleApproveRequestDto,
  }),
  cancel: (action) => ({ method: 'POST', path: `bundles/${enc(action.bundleId)}/cancel` }),
  edit: (action) => ({
    method: 'PATCH',
    path: `bundles/${enc(action.bundleId)}`,
    body: { body: action.body } satisfies BundleUpdateRequestDto,
  }),
  schedule: (action) => ({
    method: 'PATCH',
    path: `bundles/${enc(action.bundleId)}`,
    body: { scheduled_at: action.scheduledAt } satisfies BundleUpdateRequestDto,
  }),
  reply: (action) => ({
    method: 'POST',
    path: `threads/${enc(action.threadId)}/replies`,
    body: { body: action.body } satisfies ReplyCreateRequestDto,
  }),
}

function routeOf(action: MessageAction): Route {
  switch (action.kind) {
    case 'approve':
      return ROUTE.approve(action)
    case 'cancel':
      return ROUTE.cancel(action)
    case 'edit':
      return ROUTE.edit(action)
    case 'schedule':
      return ROUTE.schedule(action)
    case 'reply':
      return ROUTE.reply(action)
  }
}

const DONE: MessageActionOutcome = { kind: 'done' }

/** 옮긴 시각에 같은 사람의 예정 묶음이 있으면 서버가 그쪽으로 합치고 합친 묶음을 돌려준다 — ID 가 달라진다 */
function scheduleOutcome(bundleId: string, dto: BundleDto): MessageActionOutcome {
  const into = toBundle(dto)
  return into !== null && into.id !== bundleId ? { kind: 'merged', into } : DONE
}

/**
 * 메시지 쓰기 하나를 요청한다. 부른 쪽이 캐시를 무효화해 서버 상태로 다시 그린다.
 * 응답 본문은 시각 옮기기만 읽는다 — 합쳐졌으면 고른 묶음이 없어지므로 화면이 합친 묶음으로 옮겨 가야 한다
 */
export async function requestMessageAction(
  workspaceId: string,
  action: MessageAction,
): Promise<MessageActionOutcome> {
  const route = routeOf(action)
  const path = `${messagesPath(workspaceId)}/${route.path}`
  const init = { method: route.method, body: route.body }
  if (action.kind !== 'schedule') {
    await request(path, init)
    return DONE
  }
  return scheduleOutcome(action.bundleId, await request<BundleDto>(path, init))
}
