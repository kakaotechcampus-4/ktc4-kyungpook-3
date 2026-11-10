import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { STALE_TIME, createQueryClient } from '@/shared/api/queryClient'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { minutesQueryOptions } from './minutesQuery'

describe('minutesQueryOptions', () => {
  it('key 에 workspaceId 가 있고 팀원이 고칠 수 있어 다른 조회처럼 30초 뒤 오래된 것으로 본다 (D-192)', () => {
    const options = minutesQueryOptions('ws_01', 'mt_09')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'minutes', 'mt_09'])
    expect(options.staleTime).toBeUndefined()
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(STALE_TIME.default)
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

describe('고친 기록 (#551, §4.4.3)', () => {
  const served = () => structuredClone(minutesFixtures[1])
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const fetchMinutes = () => new QueryClient().fetchQuery(minutesQueryOptions('ws_01', 'mt_09'))

  it('고친 제목과 줄은 고친 표시와 원문을 함께 읽는다', async () => {
    const dto = served()
    dto.title = '3주차 정기 회의'
    dto.title_edited = true
    dto.title_original = '3주차 정기회의'
    dto.transcript[1] = {
      ...dto.transcript[1],
      text: '고친 문장',
      edited: true,
      original_text: '원문',
    }
    server.use(http.get('/api/v1/meetings/:meetingId/minutes', () => ok(dto)))

    const minutes = await fetchMinutes()

    expect(minutes).toMatchObject({
      title: '3주차 정기 회의',
      titleEdited: true,
      titleOriginal: '3주차 정기회의',
    })
    expect(minutes.transcript[1]).toMatchObject({
      seq: 1,
      text: '고친 문장',
      edited: true,
      originalText: '원문',
    })
    expect(minutes.transcript[0]).toMatchObject({ seq: 0, edited: false, originalText: null })
  })

  it('고치기 칸이 없는 이전 서버 응답은 고친 적 없는 회의록이고 줄은 고칠 수 없다', async () => {
    const dto: Record<string, unknown> = served()
    delete dto.title_edited
    delete dto.title_original
    dto.transcript = served().transcript.map((line) => {
      const older: Record<string, unknown> = { ...line }
      for (const key of ['seq', 'edited', 'original_text']) delete older[key]
      return older
    })
    server.use(http.get('/api/v1/meetings/:meetingId/minutes', () => ok(dto)))

    const minutes = await fetchMinutes()

    expect(minutes).toMatchObject({ titleEdited: false, titleOriginal: null })
    expect(minutes.transcript[0]).toMatchObject({ seq: null, edited: false, originalText: null })
  })

  it('표시용 칸과 줄 번호의 모양이 틀리면 그 표시만 버리고 회의록은 보인다', async () => {
    const dto = served()
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', () =>
        ok({
          ...dto,
          title_edited: 'yes',
          title_original: 3,
          transcript: dto.transcript.map((line, index) =>
            index === 0 ? { ...line, seq: -1, edited: 'no', original_text: 7 } : line,
          ),
        }),
      ),
    )

    const minutes = await fetchMinutes()

    expect(minutes).toMatchObject({ titleEdited: false, titleOriginal: null })
    expect(minutes.transcript[0]).toMatchObject({
      seq: null,
      text: dto.transcript[0].text,
      edited: false,
      originalText: null,
    })
    expect(minutes.transcript[1].seq).toBe(1)
  })
})
