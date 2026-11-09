import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { STALE_TIME } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { onTestFinished } from 'vitest'
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

it('목록은 한 건만 모르는 상태여도 전체가 실패한다. 깨진 건을 빼고 보여 주지 않는다 (#348)', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  onTestFinished(() => warning.mockRestore())
  const items = db.approvals
    .filter(({ status }) => status === 'pending')
    .map((approval, index) => (index === 1 ? { ...approval, status: 'expired' } : approval))
  server.use(http.get('/api/v1/approvals', () => ok({ items, total: items.length })))
  const client = new QueryClient()
  await expect(client.fetchQuery(pendingApprovalListQueryOptions('ws_01'))).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
    details: { entity: 'approval', path: 'items[1].status' },
  })
  expect(client.getQueryData(pendingApprovalListQueryOptions('ws_01').queryKey)).toBeUndefined()
})
