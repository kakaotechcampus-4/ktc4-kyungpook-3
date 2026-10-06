import { QueryClient } from '@tanstack/react-query'
import { STALE_TIME } from '@/shared/api/queryClient'
import { minutesQueryOptions } from './minutesQuery'

describe('minutesQueryOptions', () => {
  it('key 에 workspaceId 가 있고 끝난 회의록은 5분 동안 최신이다', () => {
    const options = minutesQueryOptions('ws_01', 'mt_09')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'minutes', 'mt_09'])
    expect(options.staleTime).toBe(STALE_TIME.long)
    expect(STALE_TIME.long).toBe(5 * 60_000)
  })

  it('회의록 본문을 Minutes 로 받는다', async () => {
    const minutes = await new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09'))
    expect(minutes).toMatchObject({ meetingId: 'mt_09', title: '3주차 정기회의', canReview: true })
    expect(minutes.transcript).toHaveLength(5)
  })
})
