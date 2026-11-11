import type { MockInstance } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { toApproval } from '../model/mapper'
import { approvalDetailQueryOptions } from './approvalDetail'
import { resolveApproval } from './resolveApproval'

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

describe('응답 검증 (#348)', () => {
  const served = () =>
    structuredClone(db.approvals.find(({ approval_id }) => approval_id === 'ap_01')!)
  let warning: MockInstance<typeof console.warn>
  beforeEach(() => {
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warning.mockRestore())

  it('상세의 모르는 상태는 승인 대기로 바꾸지 않고 잘못된 응답이다. 캐시에 넣지 않고 다시 요청하지 않는다', async () => {
    server.use(
      http.get('/api/v1/approvals/:approvalId', () => ok({ ...served(), status: 'expired' })),
    )
    const requests = recordRequests()
    const client = new QueryClient()
    const options = approvalDetailQueryOptions('ws_01', 'ap_01')
    await expect(client.fetchQuery(options)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      kind: 'invalid_response',
      details: { entity: 'approval', path: 'status' },
    })
    expect(client.getQueryData(options.queryKey)).toBeUndefined()
    expect(requests.started).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith('Invalid approval response', [
      expect.objectContaining({ path: 'status', value: 'expired' }),
    ])
  })

  it('저장된 보완 값의 모르는 상태는 그 경로로 잘못된 응답이다', async () => {
    const approval = served()
    server.use(
      http.get('/api/v1/approvals/:approvalId', () =>
        ok({
          ...approval,
          payload: { ...approval.payload, task_overrides: { status: 'archived' } },
        }),
      ),
    )
    await expect(
      new QueryClient().fetchQuery(approvalDetailQueryOptions('ws_01', 'ap_01')),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { path: 'payload.task_overrides.status' },
    })
  })

  it('승인·반려 응답의 모르는 상태도 잘못된 응답이다', async () => {
    server.use(
      http.patch('/api/v1/approvals/:approvalId', () => ok({ ...served(), status: 'expired' })),
    )
    await expect(resolveApproval('ws_01', toApproval(served()), 'rejected')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'approval', path: 'status' },
    })
  })
})
