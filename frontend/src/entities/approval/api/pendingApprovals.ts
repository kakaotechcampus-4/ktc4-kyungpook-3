import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { approvalListSchema } from '@/shared/types/api/approval'
import { toApproval } from '../model/mapper'

/**
 * 대기 중인 승인 목록. PM 만 부른다 — 일반 팀원은 이 조회를 시작하지 않는다 (D-104, D-163).
 * 회의록의 `확인 필요` 는 이 목록의 ID 집합과 추출 항목을 조인해 고른다 (`pendingItems`, 계약 §3.1).
 * 승인 상세(`['workspace', id, 'approvals', approvalId]`)와 접두어를 나눠 쓰되, 목록은 객체 칸으로 구분한다.
 */
export function pendingApprovalListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'approvals', { status: 'pending' }),
    queryFn: async ({ signal }) => {
      const { items } = parseResponse(
        approvalListSchema,
        await request<unknown>('/approvals', {
          params: { workspace_id: workspaceId, status: 'pending' },
          signal,
        }),
        'approval',
      )
      return items.map(toApproval)
    },
    staleTime: STALE_TIME.default,
  })
}

/** `pendingItems` 에 넘길 승인 ID 집합 */
export function approvalIds(approvals: readonly { id: string }[]): ReadonlySet<string> {
  return new Set(approvals.map(({ id }) => id))
}
