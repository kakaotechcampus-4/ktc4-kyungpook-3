import { http } from 'msw'
import { deletedMeetingResponse } from '../meetingDeletion'
import { db } from '../db'
import { ok, fail } from '../envelope'
import { requireAuth, requireMember } from '../auth-guard'
import { roleIn } from '../sessions'
import type { MinutesDto } from '@/shared/types/api/minutes'

/**
 * 백엔드 item_fate.readiness 의 waiting_cards. 이 회의 항목이 걸린 대기 카드 수이고 합친 카드는 한 장이다 (#605).
 * 다른 회의에 합쳐진 항목도 approval_id 가 그 카드를 가리켜 두 회의가 함께 기다린다
 */
function waitingCards(meetingId: string): number {
  const pending = new Set(
    db.approvals.filter(({ status }) => status === 'pending').map(({ approval_id }) => approval_id),
  )
  const cards = new Set<string>()
  for (const { approval_id } of itemsOf(meetingId))
    if (approval_id !== null && pending.has(approval_id)) cards.add(approval_id)
  return cards.size
}

/** 백엔드 item_fate.approved. 승인된 카드에 걸린 항목의 태스크가 살아 있다. 채팅 회의는 이것이 있어야 요약한다 */
function hasApprovedItem(meetingId: string): boolean {
  const approved = new Set(
    db.approvals
      .filter(({ status }) => status === 'approved')
      .map(({ approval_id }) => approval_id),
  )
  const live = new Set(db.tasks.map(({ task_id }) => task_id))
  return itemsOf(meetingId).some(
    ({ approval_id, task_id }) =>
      approval_id !== null && approved.has(approval_id) && task_id !== null && live.has(task_id),
  )
}

function itemsOf(meetingId: string) {
  return db.extractions
    .filter(({ meeting_id }) => meeting_id === meetingId)
    .flatMap(({ items }) => items)
}

/**
 * 저장된 `awaiting_approval` 은 백엔드 summary._state 의 순서로 다시 판정한다. 요약이 있으면 `ready`, 대기 카드가 있으면
 * `awaiting_approval`, 승인된 항목이 없는 채팅 회의는 `none`, 그 밖은 `pending` 이다. `pending` 의 1시간 창은 흉내 내지 않는다
 */
function summaryStateOf(
  minutes: MinutesDto,
  isPm: boolean,
): Pick<MinutesDto, 'summary_status' | 'summary_waiting_count'> {
  if (minutes.summary_status !== 'awaiting_approval')
    return { summary_status: minutes.summary_status, summary_waiting_count: null }
  if (minutes.summary !== null) return { summary_status: 'ready', summary_waiting_count: null }
  const waiting = waitingCards(minutes.meeting_id)
  // 백엔드는 PM 에게만 건수를 준다 (D-104)
  if (waiting > 0)
    return { summary_status: 'awaiting_approval', summary_waiting_count: isPm ? waiting : null }
  if (minutes.source === 'chat' && !hasApprovedItem(minutes.meeting_id))
    return { summary_status: 'none', summary_waiting_count: null }
  return { summary_status: 'pending', summary_waiting_count: null }
}

export const minutesHandlers = [
  http.get('/api/v1/meetings/:meetingId/minutes', ({ params }) => {
    const deleted = deletedMeetingResponse(String(params.meetingId))
    if (deleted) return deleted
    // 백엔드는 Depends(get_current_user) 가 함수 본문보다 먼저 돈다. 비로그인이면 회의가
    // 있는지 보기 전에 401 이다 — 리소스 존재 여부를 먼저 드러내지 않는다 (meetings.py:159)
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === params.meetingId)
    if (!meeting) return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    // 회의를 찾은 뒤에야 그 워크스페이스 소속을 확인해 403 을 낸다
    const denied = requireMember(meeting.workspace_id)
    if (denied) return denied
    const isPm = roleIn(meeting.workspace_id) === 'pm'
    const minutes = db.minutes.find(({ meeting_id }) => meeting_id === params.meetingId)
    const titleEdit = db.titleEdits[meeting.meeting_id]
    const titleFields = {
      title_edited: titleEdit !== undefined,
      title_original: titleEdit?.original ?? null,
    }
    if (minutes)
      return ok({
        ...minutes,
        ...titleFields,
        ...summaryStateOf(minutes, isPm),
        permissions: { can_review: isPm, can_undo: isPm },
        // 재생 API 와 같은 규칙이다 — done 이 아니면 PM 만 녹음을 안다 (#676)
        audio: meeting.status === 'done' || isPm ? minutes.audio : null,
      })
    // 백엔드는 extraction 이 없어도 200 을 준다. summary=null, transcript=[] 로 초기화한 뒤
    // 그대로 내려보낸다 (meetings.py 의 get_meeting_minutes). 빈 상태는 오류가 아니다.
    return ok({
      meeting_id: meeting.meeting_id,
      title: meeting.title,
      ...titleFields,
      started_at: meeting.started_at,
      duration_ms: 0,
      source:
        db.meetingSummaries.find(({ meeting_id }) => meeting_id === meeting.meeting_id)?.source ??
        'discord',
      attendees: [],
      summary: null,
      summary_status: 'none',
      summary_waiting_count: null,
      transcript: [],
      // 백엔드는 현재 멤버가 PM 일 때만 두 값을 true 로 준다 (meetings.py:222)
      permissions: { can_review: isPm, can_undo: isPm },
      audio: null,
    })
  }),
]
