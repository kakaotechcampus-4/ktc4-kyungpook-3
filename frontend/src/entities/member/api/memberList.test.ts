import { QueryClient } from '@tanstack/react-query'
import { STALE_TIME } from '@/shared/api/queryClient'
import { memberListQueryOptions } from './memberList'

describe('memberListQueryOptions', () => {
  it('key 에 workspaceId 가 있고 5분 동안 최신이다', () => {
    const options = memberListQueryOptions('ws_01')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'members'])
    expect(options.staleTime).toBe(STALE_TIME.long)
  })

  it('그 공간의 팀원을 Member[] 로 받는다', async () => {
    const members = await new QueryClient().fetchQuery(memberListQueryOptions('ws_01'))
    expect(members.map(({ displayName }) => displayName)).toContain('김서연')
    expect(members.every(({ workspaceId }) => workspaceId === 'ws_01')).toBe(true)
  })
})
