import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { STALE_TIME } from '@/shared/api/queryClient'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import type { MinutesDto } from '@/shared/types/api/minutes'
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

describe('응답 검증 (#348)', () => {
  const served = () => structuredClone(minutesFixtures[0])
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('모르는 출처는 discord 로 바꾸지 않고 받은 글자를 남긴다', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', () => ok({ ...served(), source: 'zoom' })),
    )
    const minutes = await new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09'))
    expect(minutes.source).toEqual({ unknown: 'zoom' })
  })

  it('audio 키가 없는 이전 서버 응답은 녹음이 없는 회의록이다 (#676)', async () => {
    const withoutAudio: Partial<MinutesDto> = served()
    delete withoutAudio.audio
    server.use(http.get('/api/v1/meetings/:meetingId/minutes', () => ok(withoutAudio)))
    const minutes = await new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09'))
    expect(minutes.audio).toBeNull()
    expect(minutes.transcript).toHaveLength(5)
  })

  it('audio 모양이 틀려도 회의록은 받고 녹음만 없는 것으로 본다 (#676)', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', () =>
        ok({ ...served(), audio: { content_type: 'audio/mp4' } }),
      ),
    )
    const minutes = await new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09'))
    expect(minutes.audio).toBeNull()
    expect(minutes.transcript).toHaveLength(5)
  })

  it('권한 모양이 틀리면 잘못된 응답이다', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', () =>
        ok({ ...served(), permissions: { can_review: 'yes', can_undo: true } }),
      ),
    )
    await expect(
      new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09')),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'minutes', path: 'permissions.can_review' },
    })
  })
})
