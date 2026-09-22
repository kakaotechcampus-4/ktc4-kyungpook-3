import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireMember } from '../auth-guard'

export const minutesHandlers = [
  http.get('/api/v1/meetings/:meetingId/minutes', ({ params }) => {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === params.meetingId)
    if (!meeting) return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    // 백엔드는 get_current_user 뒤에 회의의 워크스페이스 소속을 직접 확인해 403 을 낸다
    const denied = requireMember(meeting.workspace_id)
    if (denied) return denied
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === params.meetingId)
    return minutes
      ? ok(minutes)
      : fail('INVALID_REQUEST', '회의록 처리가 아직 끝나지 않았습니다.', 400)
  }),
]
