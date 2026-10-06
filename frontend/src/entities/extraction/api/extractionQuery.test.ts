import { QueryClient } from '@tanstack/react-query'
import { STALE_TIME } from '@/shared/api/queryClient'
import { extractionQueryOptions } from './extractionQuery'

describe('extractionQueryOptions', () => {
  it('key 에 workspaceId 가 있고 30초 동안 최신이다', () => {
    const options = extractionQueryOptions('ws_01', 'ex_01')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'extractions', 'ex_01'])
    expect(options.staleTime).toBe(STALE_TIME.default)
    expect(STALE_TIME.default).toBe(30_000)
  })

  it('추출 결과를 Extraction 으로 받는다', async () => {
    const extraction = await new QueryClient().fetchQuery(extractionQueryOptions('ws_01', 'ex_01'))
    expect(extraction).toMatchObject({ id: 'ex_01', meetingId: 'mt_09' })
    expect(extraction.items).toHaveLength(6)
  })
})
