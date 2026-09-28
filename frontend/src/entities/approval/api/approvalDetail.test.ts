import { QueryClient } from '@tanstack/react-query'
import { approvalDetailQueryOptions } from './approvalDetail'

describe('approvalDetailQueryOptions', () => {
  it('key 에 workspaceId 가 있다', () => {
    expect(approvalDetailQueryOptions('ws_01', 'ap_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'approvals',
      'ap_01',
    ])
  })

  it('최신 시간을 따로 정하지 않는다 — 기본 30초를 쓴다', () => {
    expect(approvalDetailQueryOptions('ws_01', 'ap_01').staleTime).toBeUndefined()
  })

  it('승인 상세를 Approval 로 받는다', async () => {
    const approval = await new QueryClient().fetchQuery(
      approvalDetailQueryOptions('ws_01', 'ap_01'),
    )
    expect(approval).toMatchObject({ id: 'ap_01', kind: 'task_create', workspaceId: 'ws_01' })
  })
})
