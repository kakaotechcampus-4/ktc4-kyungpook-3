import { HttpResponse, http } from 'msw'
import { db } from '../db'
import { deletedMeetingResponse } from '../meetingDeletion'
import { fail, ok } from '../envelope'
import { requirePmRole } from '../auth-guard'
import { SPEAKER_AUDIO_SECONDS } from '../fixtures/speaker'
import { byteRange, silentWav } from '../speakerAudio'
import { assignMockSpeakers, speakerViewOf } from '../speakerFlow'
import { readJson } from '../utils'

/*
 * 업로드 회의 화자 지정 — PM 경로 (계약 §2.3.1). 백엔드 순서대로 회의가 없으면 404, 그 공간 PM 이 아니면 403,
 * 업로드 회의가 아니면 404 다. 녹음은 봉투 없이 바이트로 주고 Range 에 206 으로 답한다
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

let audio: Uint8Array | null = null

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
  http.get('/api/v1/meetings/:meetingId/audio', ({ params, request }) => {
    const meetingId = String(params.meetingId)
    const found = uploadFor(meetingId)
    if (found instanceof Response) return found
    if (speakerViewOf(found.meeting, found.upload).audio === null) return notFound(meetingId)
    audio ??= silentWav(SPEAKER_AUDIO_SECONDS)
    const headers = {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    const range = byteRange(request.headers.get('range'), audio.byteLength)
    if (range === null)
      return new HttpResponse(audio.slice(), {
        headers: { ...headers, 'Content-Length': String(audio.byteLength) },
      })
    const part = audio.slice(range.start, range.end + 1)
    return new HttpResponse(part, {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(part.byteLength),
        'Content-Range': `bytes ${range.start}-${range.end}/${audio.byteLength}`,
      },
    })
  }),
]
