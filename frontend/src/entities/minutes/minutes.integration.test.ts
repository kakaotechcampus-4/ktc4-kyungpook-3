import { http } from 'msw'
import { server } from '@/shared/mock/server'
import { ok } from '@/shared/mock/envelope'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import { fetchDto } from '@/shared/test/api'
import type { MinutesDto } from '@/shared/types/api/minutes'
import { toMinutes } from './model/mapper'

it('round trips a five-line transcript and preserves the unknown speaker fallback', async () => {
  const minutes = toMinutes(await fetchDto<MinutesDto>('/meetings/mt_09/minutes'))
  expect(minutes.transcript).toHaveLength(5)
  expect(minutes.attendees).toHaveLength(4)
  expect(minutes.transcript[3]).toMatchObject({ speakerName: 'jihun_dev', isFallbackName: true })
  expect(minutes).toMatchObject({ canReview: true, canUndo: true })
  await expect(fetchDto('/meetings/missing/minutes')).rejects.toMatchObject({
    code: 'MEETING_NOT_FOUND',
    status: 404,
  })
})

it('supports a non-PM permission override without leaking previous handler state', async () => {
  server.use(
    http.get('/api/v1/meetings/:meetingId/minutes', () =>
      ok({ ...minutesFixtures[1], permissions: { can_review: false, can_undo: false } }),
    ),
  )
  expect(toMinutes(await fetchDto<MinutesDto>('/meetings/mt_09/minutes'))).toMatchObject({
    canReview: false,
    canUndo: false,
  })
})
