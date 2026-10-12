import { QueryClient } from '@tanstack/react-query'
import { STALE_TIME } from '@/shared/api/queryClient'
import { recordRequests } from '@/shared/test/requests'
import { approvalDetailQueryOptions } from './approvalDetail'
import { approvalIds, pendingApprovalListQueryOptions } from './pendingApprovals'

describe('pendingApprovalListQueryOptions', () => {
  it('key 에 workspaceId 가 있고 30초 동안 최신이다. 승인 상세 key 와 겹치지 않는다', () => {
    const options = pendingApprovalListQueryOptions('ws_01')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'approvals', { status: 'pending' }])
    expect(options.staleTime).toBe(STALE_TIME.default)
    expect(options.queryKey).not.toEqual(approvalDetailQueryOptions('ws_01', 'pending').queryKey)
  })

  it('그 공간의 대기 승인만 status=pending 으로 요청해 Approval[] 로 받는다', async () => {
    const log = recordRequests()
    const approvals = await new QueryClient().fetchQuery(pendingApprovalListQueryOptions('ws_01'))
    expect(log.started).toEqual([
      { method: 'GET', path: '/approvals?workspace_id=ws_01&status=pending' },
    ])
    expect(approvals.map(({ id }) => id)).toEqual(['ap_03', 'ap_02', 'ap_01'])
    expect(approvals.every(({ status }) => status === 'pending')).toBe(true)
    expect([...approvalIds(approvals)].sort()).toEqual(['ap_01', 'ap_02', 'ap_03'])
  })
})
