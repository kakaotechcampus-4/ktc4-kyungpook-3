import { http } from 'msw'
import { db } from '../db'
import { fail, ok } from '../envelope'
import { requireAuth, requireMember } from '../auth-guard'
import { deletedMeetingResponse } from '../meetingDeletion'
import { readJson } from '../utils'
import { PYTHON_STRIP, hasUnstorable, invalidBody } from '../validation'
import type { FieldError } from '../validation'

/* 회의 기록 고치기 (#605 BE PR #669 — api/meetings.py, services/transcript.py, schemas/record_edit.py, 계약 §4.4.3) */

const TITLE_MAX = 200
const LINE_MAX = 10_000

const codePoints = (text: string) => [...text].length

/** 문자열이거나 null 인 필수 칸. 저장할 수 없는 글자는 BE `_Storable` 처럼 400 이다 */
function nullableText(
  body: Record<string, unknown> | null,
  name: string,
  check: (text: string) => string | null,
): { value: string | null } | { error: FieldError } {
  if (body === null || !(name in body))
    return { error: { loc: ['body', name], msg: 'Field required' } }
  const value = body[name]
  if (value === null) return { value: null }
  if (typeof value !== 'string')
    return { error: { loc: ['body', name], msg: 'Input should be a valid string' } }
  const problem = hasUnstorable(value)
    ? 'Value error, NUL 이나 짝 없는 서로게이트 글자는 저장할 수 없습니다.'
    : check(value)
  return problem === null ? { value } : { error: { loc: ['body', name], msg: problem } }
}

/** BE `_meeting_of_member` → `require_live_meeting`. 지운 회의는 소속 확인 뒤 410 이다 */
function liveMeeting(meetingId: string) {
  const deleted = deletedMeetingResponse(meetingId)
  if (deleted) return { denied: deleted }
  const meeting = db.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!meeting) return { denied: fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404) }
  const denied = requireMember(meeting.workspace_id)
  return denied ? { denied } : { meeting }
}

export const minutesEditHandlers = [
  http.patch('/api/v1/meetings/:meetingId/title', async ({ params, request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const field = nullableText(await readJson(request), 'title', (text) => {
      const length = codePoints(text.replace(PYTHON_STRIP, ''))
      return length >= 1 && length <= TITLE_MAX
        ? null
        : `String should have between 1 and ${TITLE_MAX} characters`
    })
    if ('error' in field) return invalidBody(field.error)!
    const found = liveMeeting(String(params.meetingId))
    if ('denied' in found) return found.denied
    const { meeting } = found
    const previous = db.titleEdits[meeting.meeting_id]
    const original = previous === undefined ? meeting.title : previous.original
    const title = field.value === null ? null : field.value.replace(PYTHON_STRIP, '')
    const revert = field.value === null || title === original
    const next = revert ? original : title
    meeting.title = next
    for (const summary of db.meetingSummaries)
      if (summary.meeting_id === meeting.meeting_id) summary.title = next
    for (const minutes of db.minutes)
      if (minutes.meeting_id === meeting.meeting_id) minutes.title = next
    if (revert) delete db.titleEdits[meeting.meeting_id]
    else db.titleEdits[meeting.meeting_id] = { original }
    return ok({
      meeting_id: meeting.meeting_id,
      title: next,
      title_original: revert ? null : original,
      title_edited: !revert,
    })
  }),
  http.patch('/api/v1/meetings/:meetingId/transcript/:seq', async ({ params, request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const seqText = String(params.seq)
    const seqError: FieldError | null = /^-?\d+$/.test(seqText)
      ? null
      : { loc: ['path', 'seq'], msg: 'Input should be a valid integer' }
    const field = nullableText(await readJson(request), 'text', (text) =>
      codePoints(text) < 1 || codePoints(text) > LINE_MAX
        ? `String should have between 1 and ${LINE_MAX} characters`
        : text.replace(PYTHON_STRIP, '') === ''
          ? 'Value error, 공백만인 글은 받지 않습니다.'
          : null,
    )
    if (seqError || 'error' in field)
      return invalidBody(seqError, 'error' in field ? field.error : null)!
    const found = liveMeeting(String(params.meetingId))
    if ('denied' in found) return found.denied
    const seq = Number(seqText)
    const line = db.minutes
      .find(({ meeting_id }) => meeting_id === found.meeting.meeting_id)
      ?.transcript.find((candidate) => candidate.seq === seq)
    if (!line)
      return fail('TRANSCRIPT_LINE_NOT_FOUND', '해당 발화를 찾을 수 없습니다.', 404, {
        meeting_id: found.meeting.meeting_id,
        seq,
      })
    const original = line.edited ? (line.original_text ?? line.text) : line.text
    const revert = field.value === null || field.value === original
    line.text = revert ? original : field.value!
    line.edited = !revert
    line.original_text = revert ? null : original
    return ok({ seq, text: line.text, original_text: line.original_text, edited: line.edited })
  }),
]
