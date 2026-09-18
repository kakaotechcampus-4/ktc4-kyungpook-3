import { http } from 'msw'
import type { MeetingDto } from '@/shared/types/api/meeting'
import { db } from '../db'
import { ok, list, fail } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { readJson, nextId } from '../utils'

export const meetingHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/meetings', ({ params }) => {
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === params.workspaceId))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    const meetings = db.meetings.filter(
      (meeting) => meeting.workspace_id === params.workspaceId && meeting.status !== 'failed',
    )
    return list(
      db.meetingSummaries
        .filter((summary) => meetings.some(({ meeting_id }) => meeting_id === summary.meeting_id))
        .map((summary) => ({
          ...summary,
          status: meetings.find(({ meeting_id }) => meeting_id === summary.meeting_id)!.status,
        }))
        .sort((a, b) => b.started_at.localeCompare(a.started_at)),
    )
  }),
  http.get('/api/v1/meetings/:meetingId', ({ params }) => {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === params.meetingId)
    return meeting
      ? ok({ ...meeting, extraction_id: meeting.status === 'done' ? meeting.extraction_id : null })
      : fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
  }),
  http.post('/api/v1/meetings', async ({ request }) => {
    const body = await readJson(request)
    if (
      !body ||
      typeof body.workspace_id !== 'string' ||
      (body.title !== undefined && body.title !== null && typeof body.title !== 'string') ||
      (body.source !== undefined && body.source !== 'discord' && body.source !== 'manual_upload')
    )
      return fail('INVALID_REQUEST', '회의 요청이 올바르지 않습니다.', 400)
    const meeting: MeetingDto = {
      meeting_id: nextId(
        'mt',
        db.meetings.map(({ meeting_id }) => meeting_id),
      ),
      workspace_id: body.workspace_id,
      title: typeof body.title === 'string' ? body.title : null,
      status: 'created',
      started_at: MOCK_NOW,
      ended_at: null,
      extraction_id: null,
      failed_stage: null,
    }
    db.meetings.push(meeting)
    db.meetingSummaries.push({
      meeting_id: meeting.meeting_id,
      title: meeting.title ?? '',
      status: 'created',
      source: body.source === 'manual_upload' ? 'manual_upload' : 'discord',
      started_at: MOCK_NOW,
      duration_ms: null,
      attendee_count: 0,
      processed_at: null,
    })
    return ok(
      {
        meeting_id: meeting.meeting_id,
        workspace_id: meeting.workspace_id,
        status: meeting.status,
        started_at: meeting.started_at,
      },
      { status: 201 },
    )
  }),
  http.patch('/api/v1/meetings/:meetingId/end', ({ params }) => {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === params.meetingId)
    if (!meeting) return fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
    if (['processing', 'done', 'failed'].includes(meeting.status))
      return fail('MEETING_ALREADY_ENDED', '이미 종료된 회의입니다.', 409, {
        meeting_id: meeting.meeting_id,
        status: meeting.status,
      })
    meeting.status = 'processing'
    meeting.ended_at = MOCK_NOW
    return ok(
      { meeting_id: meeting.meeting_id, status: meeting.status, ended_at: meeting.ended_at },
      { status: 202 },
    )
  }),
  http.post('/api/v1/workspaces/:workspaceId/meetings/upload', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === workspaceId))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return fail('INVALID_REQUEST', '업로드 형식이 올바르지 않습니다.', 400)
    }
    const file = form.get('file')
    const title = form.get('title')
    const startedAt = form.get('started_at')
    const attendees = form.getAll('attendee_member_ids')
    if (
      !file ||
      typeof file === 'string' ||
      typeof title !== 'string' ||
      !title.trim() ||
      typeof startedAt !== 'string' ||
      !Number.isFinite(Date.parse(startedAt)) ||
      attendees.length === 0 ||
      attendees.some(
        (id) =>
          typeof id !== 'string' ||
          !db.members.some(
            (member) => member.workspace_id === workspaceId && member.member_id === id,
          ),
      )
    )
      return fail('INVALID_REQUEST', '파일·제목·회의 날짜·참석자가 필요합니다.', 400)
    const processing = db.meetings.find(
      (meeting) => meeting.workspace_id === workspaceId && meeting.status === 'processing',
    )
    if (processing)
      return fail('MEETING_PROCESSING_IN_PROGRESS', '처리 중인 회의가 있습니다.', 409, {
        meeting_id: processing.meeting_id,
      })
    const notion = db.integrations[workspaceId]?.notion.status
    if (notion !== 'connected')
      return fail(
        notion === 'revoked' ? 'INTEGRATION_REVOKED' : 'INTEGRATION_NOT_CONNECTED',
        'Notion 연결을 확인해주세요.',
        409,
      )
    const meeting: MeetingDto = {
      meeting_id: nextId(
        'mt',
        db.meetings.map(({ meeting_id }) => meeting_id),
      ),
      workspace_id: workspaceId,
      title,
      status: 'processing',
      started_at: startedAt,
      ended_at: null,
      extraction_id: null,
      failed_stage: null,
    }
    db.meetings.push(meeting)
    db.meetingSummaries.push({
      meeting_id: meeting.meeting_id,
      title,
      status: 'processing',
      source: 'manual_upload',
      started_at: startedAt,
      duration_ms: null,
      attendee_count: attendees.length,
      processed_at: null,
    })
    return ok({ meeting_id: meeting.meeting_id, status: meeting.status }, { status: 202 })
  }),
]
