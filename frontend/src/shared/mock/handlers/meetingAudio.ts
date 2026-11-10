import { HttpResponse, http } from 'msw'
import { requireMember, requirePmRole } from '../auth-guard'
import { db } from '../db'
import { fail } from '../envelope'
import { MOCK_RECORDING_SECONDS, audioUnavailableReason, mockS3AudioUrl } from '../meetingAudio'
import { deletedMeetingResponse } from '../meetingDeletion'
import { byteRange, silentWav } from '../speakerAudio'

/*
 * 회의 녹음 재생 (계약 §2.3.1, #676). 실 서버의 S3 모드처럼 권한을 본 뒤 임시 주소로 302 하고,
 * 그 주소는 봉투 없이 바이트를 주며 Range 에 206 으로 답한다. done 회의는 팀원 모두, 그 밖에는 PM 만 듣는다
 */

let recording: Uint8Array | null = null

export const meetingAudioHandlers = [
  http.get('/api/v1/meetings/:meetingId/audio', ({ params }) => {
    const meetingId = String(params.meetingId)
    const deleted = deletedMeetingResponse(meetingId)
    if (deleted) return deleted
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
    if (!meeting)
      return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404, { meeting_id: meetingId })
    const denied =
      meeting.status === 'done'
        ? requireMember(meeting.workspace_id)
        : requirePmRole(meeting.workspace_id)
    if (denied) return denied
    const reason = audioUnavailableReason(meeting)
    if (reason !== null)
      return fail('AUDIO_NOT_AVAILABLE', '들을 수 있는 녹음이 없습니다.', 404, {
        meeting_id: meetingId,
        reason,
      })
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: mockS3AudioUrl(meetingId), 'Cache-Control': 'private, no-store' },
    })
  }),
  http.get('/__mock/s3/meetings/:meetingId/audio.wav', ({ request }) => {
    recording ??= silentWav(MOCK_RECORDING_SECONDS)
    const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes' }
    const range = byteRange(request.headers.get('range'), recording.byteLength)
    if (range === null)
      return new HttpResponse(recording.slice(), {
        headers: { ...headers, 'Content-Length': String(recording.byteLength) },
      })
    const part = recording.slice(range.start, range.end + 1)
    return new HttpResponse(part, {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(part.byteLength),
        'Content-Range': `bytes ${range.start}-${range.end}/${recording.byteLength}`,
      },
    })
  }),
]
