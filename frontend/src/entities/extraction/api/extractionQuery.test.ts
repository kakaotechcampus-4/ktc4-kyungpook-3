import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { STALE_TIME } from '@/shared/api/queryClient'
import { extractionFixtures } from '@/shared/mock/fixtures/extraction'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
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

describe('응답 검증 (#348)', () => {
  const served = () => structuredClone(extractionFixtures[1])
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('항목 한 건의 모양이 틀리면 추출 전체가 잘못된 응답이다', async () => {
    const extraction = served()
    extraction.items[2] = { ...extraction.items[2], task_id: 7 } as never
    server.use(http.get('/api/v1/extractions/:extractionId', () => ok(extraction)))
    await expect(
      new QueryClient().fetchQuery(extractionQueryOptions('ws_01', 'ex_01')),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'extraction', path: 'items[2].task_id' },
    })
  })

  it('모르는 판단은 hold, 모르는 승인 상태는 null 로 읽고 경고한다 (보수 폴백)', async () => {
    const extraction = served()
    extraction.items[0] = { ...extraction.items[0], gate: 'later', approval_status: 'expired' }
    server.use(http.get('/api/v1/extractions/:extractionId', () => ok(extraction)))
    const { items } = await new QueryClient().fetchQuery(extractionQueryOptions('ws_01', 'ex_01'))
    expect(items[0]).toMatchObject({ gate: 'hold', approvalStatus: null })
    expect(console.warn).toHaveBeenCalledWith('Unknown extraction gate: later')
    expect(console.warn).toHaveBeenCalledWith('Unknown extraction approval status: expired')
  })
})
