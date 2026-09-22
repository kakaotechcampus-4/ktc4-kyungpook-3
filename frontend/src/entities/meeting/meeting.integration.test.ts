import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type {
  MeetingDto,
  MeetingSummaryDto,
  MeetingCreateDto,
  MeetingEndDto,
  MeetingUploadDto,
} from '@/shared/types/api/meeting'
import { db } from '@/shared/mock/db'
import { toMeeting, toMeetingSummary } from './model/mapper'
import { File as NodeFile } from 'node:buffer'

// Undici의 multipart 파서는 Node File을 요구한다. jsdom File로 바뀐 전역을
// 이 HTTP 테스트 동안만 복원하며 브라우저 handler는 그대로 사용한다.
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => vi.unstubAllGlobals())

function uploadBody(): RequestInit {
  const boundary = 'm1-upload-boundary'
  const fields = [
    ['title', '지난 회의 녹음'],
    ['started_at', '2026-09-14T05:00:00Z'],
    ['attendee_member_ids', 'mb_01'],
  ]
  const parts = fields.map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  )
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="meeting.mp3"\r\nContent-Type: audio/mpeg\r\n\r\naudio\r\n--${boundary}--\r\n`,
  )
  return {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: parts.join(''),
  }
}

it('scopes and sorts summaries, excludes failed meetings and maps detail', async () => {
  const summaries = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
  expect(summaries.items.map(toMeetingSummary).map(({ id }) => id)).toEqual([
    'mt_10',
    'mt_09',
    'mt_07',
  ])
  expect(await fetchDto('/workspaces/ws_02/meetings')).toEqual({ items: [], total: 0 })
  expect(toMeeting(await fetchDto<MeetingDto>('/meetings/mt_09')).extractionId).toBe('ex_01')
  db.meetings[2].status = 'failed'
  expect((await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')).total).toBe(2)
  await expect(fetchDto('/meetings/missing')).rejects.toMatchObject({
    code: 'MEETING_NOT_FOUND',
    status: 404,
  })
})

it('creates and ends a bot meeting once', async () => {
  const created = await fetchDto<MeetingCreateDto>(
    '/meetings',
    jsonRequest('POST', { workspace_id: 'ws_01' }),
  )
  expect(created).toMatchObject({ status: 'created', workspace_id: 'ws_01' })
  expect(toMeeting(await fetchDto<MeetingDto>(`/meetings/${created.meeting_id}`)).title).toBe('')
  const ended = await fetchDto<MeetingEndDto>(`/meetings/${created.meeting_id}/end`, {
    method: 'PATCH',
  })
  expect(ended).toMatchObject({ status: 'processing' })
  await expect(
    fetchDto(`/meetings/${created.meeting_id}/end`, { method: 'PATCH' }),
  ).rejects.toMatchObject({ code: 'MEETING_ALREADY_ENDED', status: 409 })
})

it('returns the processing conflict then accepts multipart upload and preserves the supplied date', async () => {
  await expect(fetchDto('/workspaces/ws_01/meetings/upload', uploadBody())).rejects.toMatchObject({
    code: 'MEETING_PROCESSING_IN_PROGRESS',
    status: 409,
    details: { meeting_id: 'mt_10' },
  })
  db.meetings[2].status = 'done'
  const uploaded = await fetchDto<MeetingUploadDto>(
    '/workspaces/ws_01/meetings/upload',
    uploadBody(),
  )
  expect(uploaded).toMatchObject({ status: 'processing' })
  expect(toMeeting(await fetchDto<MeetingDto>(`/meetings/${uploaded.meeting_id}`))).toMatchObject({
    startedAt: '2026-09-14T05:00:00Z',
    title: '지난 회의 녹음',
    extractionId: null,
  })
})

it('rejects incomplete multipart requests and disconnected Notion', async () => {
  await expect(
    fetchDto('/workspaces/ws_01/meetings/upload', jsonRequest('POST', {})),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  db.meetings[2].status = 'done'
  db.integrations.ws_01.notion.status = 'revoked'
  await expect(fetchDto('/workspaces/ws_01/meetings/upload', uploadBody())).rejects.toMatchObject({
    code: 'INTEGRATION_REVOKED',
    status: 409,
  })
})
