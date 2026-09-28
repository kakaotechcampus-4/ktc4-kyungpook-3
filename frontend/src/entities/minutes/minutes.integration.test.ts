import { http } from 'msw'
import { server } from '@/shared/mock/server'
import { ok } from '@/shared/mock/envelope'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import { db } from '@/shared/mock/db'
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

// 백엔드는 extraction 이 없어도 200 을 준다. summary=null, transcript=[] 로 초기화한 뒤
// 그대로 내려보낸다 (meetings.py). MSW 가 400 을 내면 정상 빈 상태가 오류 UI 로만 검증된다
it('returns an empty body instead of an error when the meeting has no minutes yet', async () => {
  const minutes = toMinutes(await fetchDto<MinutesDto>('/meetings/mt_10/minutes'))
  expect(minutes).toMatchObject({
    meetingId: 'mt_10',
    summary: null,
    transcript: [],
    attendees: [],
  })
})

// 백엔드는 현재 멤버가 PM 일 때만 can_review·can_undo 를 true 로 준다 (meetings.py:222).
// 하드코딩하면 일반 팀원 화면에 PM 전용 확인·되돌리기 UI 가 열린다 (D-104)
it('derives minutes permissions from the current role instead of hardcoding them', async () => {
  // mt_09 는 ws_01 소속이고 현재 사용자가 PM 이다
  expect(toMinutes(await fetchDto<MinutesDto>('/meetings/mt_09/minutes'))).toMatchObject({
    canReview: true,
    canUndo: true,
  })

  // ws_02 에서는 일반 팀원이다. 그 워크스페이스의 회의록은 권한이 없어야 한다
  db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_01')!.role = 'member'
  expect(toMinutes(await fetchDto<MinutesDto>('/meetings/mt_09/minutes'))).toMatchObject({
    canReview: false,
    canUndo: false,
  })
})
