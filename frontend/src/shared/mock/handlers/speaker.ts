import { http } from 'msw'
import { db } from '../db'
import { deletedMeetingResponse } from '../meetingDeletion'
import { fail, ok } from '../envelope'
import { requirePmRole } from '../auth-guard'
import { assignMockSpeakers, speakerViewOf } from '../speakerFlow'
import { readJson } from '../utils'

/*
 * 업로드 회의 화자 지정 — PM 경로 (계약 §2.3.1). 백엔드 순서대로 회의가 없으면 404, 그 공간 PM 이 아니면 403,
 * 업로드 회의가 아니면 404 다. 녹음 재생 경로는 회의록과 함께 handlers/meetingAudio.ts 에 있다
 */

function notFound(meetingId: string) {
  return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404, { meeting_id: meetingId })
}

function uploadFor(meetingId: string) {
  const deleted = deletedMeetingResponse(meetingId)
  if (deleted) return deleted
  const meeting = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!meeting) return notFound(meetingId)
  const denied = requirePmRole(meeting.workspace_id)
  if (denied) return denied
  const upload = db.meetingFlow.speakers[meetingId]
  return upload ? { meeting, upload } : notFound(meetingId)
}

function isMapping(value: unknown): value is Record<string, string | null> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((id) => id === null || typeof id === 'string')
  )
}

export const speakerHandlers = [
  http.get('/api/v1/meetings/:meetingId/speakers', ({ params }) => {
    const found = uploadFor(String(params.meetingId))
    if (found instanceof Response) return found
    return ok(speakerViewOf(found.meeting, found.upload))
  }),
  http.put('/api/v1/meetings/:meetingId/speakers', async ({ params, request }) => {
    const meetingId = String(params.meetingId)
    const found = uploadFor(meetingId)
    if (found instanceof Response) return found
    const body = await readJson(request)
    if (!body || !isMapping(body.mapping))
      return fail('INVALID_REQUEST', '지정 형식이 올바르지 않습니다.', 400)
    const result = assignMockSpeakers(meetingId, body.mapping)
    switch (result.kind) {
      case 'assigned':
        return ok({ meeting_id: meetingId, status: result.status })
      case 'invalid':
        return fail('INVALID_REQUEST', '화자 지정이 올바르지 않습니다.', 400, result.details)
      case 'notAwaiting':
        return fail('MEETING_NOT_AWAITING_SPEAKERS', '화자 지정 대기 중이 아닙니다.', 409, {
          meeting_id: meetingId,
          status: result.status,
        })
    }
  }),
]
