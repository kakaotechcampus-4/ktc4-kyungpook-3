import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type {
  MessageInboxDto,
  MessageReviewPatchDto,
  MessageThreadDto,
} from '@/shared/types/api/message'
import { toMessageInbox, toMessageThread } from '../model/mapper'
import type { MessageReviewAction } from '../model/types'

/*
 * 메시지 조회와 보내기 전 확인 항목의 행동. 경로는 MSW 에만 있는 임시 경로라 계약이 아니다 — 실제 API 가 생기면 바꾼다
 * (M8 계획 C-8). 상태 동기화(polling)는 두지 않는다 — 행동이 성공하면 아래 key 를 무효화해 다시 받는다.
 */

function messagesPath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/messages`
}

/** 그 공간의 메시지 캐시 전체(목록·대화). 행동이 성공하면 이 key 를 무효화한다 */
export function messageKeys(workspaceId: string) {
  return workspaceKey(workspaceId, 'messages')
}

/** 왼쪽 목록 — 보내기 전 확인 항목과 대화 요약 */
export function messageInboxQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'inbox'),
    queryFn: async ({ signal }) =>
      toMessageInbox(await request<MessageInboxDto>(messagesPath(workspaceId), { signal })),
  })
}

/** 대화 하나. 목록과 따로 받는다 — 한쪽 오류가 다른 쪽을 막지 않는다 (계획 C-6 5단계) */
export function messageThreadQueryOptions(workspaceId: string, threadId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'messages', 'threads', threadId),
    queryFn: async ({ signal }) =>
      toMessageThread(
        await request<MessageThreadDto>(
          `${messagesPath(workspaceId)}/threads/${encodeURIComponent(threadId)}`,
          { signal },
        ),
      ),
  })
}

function patchOf(action: Extract<MessageReviewAction, { kind: 'edit' | 'schedule' }>) {
  if (action.kind === 'edit') return { body: action.body } satisfies MessageReviewPatchDto
  return {
    send_timing: action.timing,
    scheduled_at: action.timing === 'custom' ? action.scheduledAt : undefined,
  } satisfies MessageReviewPatchDto
}

/** 보내기 전 확인 항목에 행동 하나를 요청한다. 응답 본문은 쓰지 않는다 — 부른 쪽이 캐시를 무효화해 서버 상태로 다시 그린다 */
export async function requestMessageReviewAction(
  workspaceId: string,
  reviewId: string,
  action: MessageReviewAction,
): Promise<void> {
  const reviewPath = `${messagesPath(workspaceId)}/reviews/${encodeURIComponent(reviewId)}`
  if (action.kind === 'send' || action.kind === 'dismiss')
    await request(`${reviewPath}/${action.kind}`, { method: 'POST' })
  else await request(reviewPath, { method: 'PATCH', body: patchOf(action) })
}
