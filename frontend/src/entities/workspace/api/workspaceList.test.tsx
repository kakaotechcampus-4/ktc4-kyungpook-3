import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createQueryClient, STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { recordRequests } from '@/shared/test/requests'
import {
  WORKSPACE_LIST_QUERY_KEY,
  fetchWorkspaces,
  useMemberWorkspace,
  workspaceListQueryOptions,
} from './workspaceList'

function wrapperWith(client = createQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('워크스페이스 목록', () => {
  it('온보딩 정보가 든 Workspace[] 로 돌려준다', async () => {
    const workspaces = await fetchWorkspaces()
    expect(workspaces.map(({ id }) => id)).toEqual(['ws_02', 'ws_01'])
    expect(workspaces[0]).toMatchObject({
      role: 'member',
      onboarding: { completed: false, currentStep: 'connect_notion' },
    })
  })

  it('5분 동안 최신이다', () => {
    expect(workspaceListQueryOptions().staleTime).toBe(STALE_TIME.long)
  })

  it('목록 key 는 워크스페이스 범위 key 와 접두어를 나누지 않는다', () => {
    expect(WORKSPACE_LIST_QUERY_KEY[0]).not.toBe(workspaceKey('ws_01')[0])
  })
})

describe('useMemberWorkspace', () => {
  it('목록에서 고르고 상세(GET /workspaces/{id})를 부르지 않는다', async () => {
    const log = recordRequests()
    const { result } = renderHook(() => useMemberWorkspace('ws_01'), { wrapper: wrapperWith() })
    await waitFor(() => expect(result.current?.id).toBe('ws_01'))
    expect(log.started.map(({ path }) => path)).toEqual(['/workspaces'])
  })

  it('목록에 없는 공간은 null 이다', async () => {
    const client = createQueryClient()
    const { result } = renderHook(() => useMemberWorkspace('ws_99'), {
      wrapper: wrapperWith(client),
    })
    await waitFor(() => expect(client.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toBeDefined())
    expect(result.current).toBeNull()
  })
})
