import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireAuth, requireMember } from '../auth-guard'

export const minutesHandlers = [
  http.get('/api/v1/meetings/:meetingId/minutes', ({ params }) => {
    // 백엔드는 Depends(get_current_user) 가 함수 본문보다 먼저 돈다. 비로그인이면 회의가
    // 있는지 보기 전에 401 이다 — 리소스 존재 여부를 먼저 드러내지 않는다 (meetings.py:159)
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === params.meetingId)
    if (!meeting) return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    // 회의를 찾은 뒤에야 그 워크스페이스 소속을 확인해 403 을 낸다
    const denied = requireMember(meeting.workspace_id)
    if (denied) return denied
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === params.meetingId)
    if (minutes) return ok(minutes)
    // 백엔드는 extraction 이 없어도 200 을 준다. summary=null, transcript=[] 로 초기화한 뒤
    // 그대로 내려보낸다 (meetings.py 의 get_meeting_minutes). 빈 상태는 오류가 아니다.
    return ok({
      meeting_id: meeting.meeting_id,
      title: meeting.title,
      started_at: meeting.started_at,
      duration_ms: 0,
      source:
        db.meetingSummaries.find(({ meeting_id }) => meeting_id === meeting.meeting_id)?.source ??
        'discord',
      attendees: [],
      summary: null,
      transcript: [],
      permissions: { can_review: true, can_undo: true },
    })
  }),
]
