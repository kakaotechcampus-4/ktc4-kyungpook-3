import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { MessageInboxDto, MessageThreadDto } from '@/shared/types/api/message'
import { toMessageInbox, toMessageThread } from '../model/mapper'

/*
 * 메시지 조회. 경로는 MSW 에만 있는 임시 경로라 계약이 아니다 — 실제 API 가 생기면 바꾼다 (M8 계획 C-8).
 * 상태 동기화(polling)는 결정 4·D-136 뒤에 정한다. 지금은 기본 최신 시간(30초)만 쓴다.
 */

function messagesPath(workspaceId: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/messages`
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
