import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ApprovalDto } from '@/shared/types/api/approval'
import { toApproval } from '../model/mapper'

/** 승인 상세. 기본 최신 시간(30초)을 쓴다. PM 가드를 통과한 화면만 이 조회를 시작한다 */
export function approvalDetailQueryOptions(workspaceId: string, approvalId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'approvals', approvalId),
    queryFn: async ({ signal }) =>
      toApproval(
        await request<ApprovalDto>(`/approvals/${encodeURIComponent(approvalId)}`, { signal }),
      ),
  })
}
