import type { RequestOptions } from '@/shared/api/client'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { MeetingDto, MeetingSummaryDto, MeetingUploadDto } from '@/shared/types/api/meeting'
import { db } from '@/shared/mock/db'
import { toMeeting, toMeetingSummary } from './model/mapper'
import { File as NodeFile } from 'node:buffer'

// Undici의 multipart 파서는 Node File을 요구한다. jsdom File로 바뀐 전역을
// 이 HTTP 테스트 동안만 복원하며 브라우저 handler는 그대로 사용한다.
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => vi.unstubAllGlobals())

function uploadBody(): RequestOptions {
  const form = new FormData()
  form.append('title', '지난 회의 녹음')
  form.append('started_at', '2026-09-14T05:00:00Z')
  form.append('attendee_member_ids', 'mb_01')
  form.append('file', new Blob(['audio'], { type: 'audio/mpeg' }), 'meeting.mp3')
  return { method: 'POST', body: form }
}

it('scopes and sorts summaries, excludes failed meetings and maps detail', async () => {
  const summaries = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
  expect(summaries.items.map(toMeetingSummary).map(({ id }) => id)).toEqual([
    'mt_10',
    'mt_09',
    'mt_08',
    'mt_07',
  ])
  expect(await fetchDto('/workspaces/ws_02/meetings')).toEqual({ items: [], total: 0 })
  expect(toMeeting(await fetchDto<MeetingDto>('/meetings/mt_09')).extractionId).toBe('ex_01')
  db.meetings[2].status = 'failed'
  expect((await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')).total).toBe(3)
  await expect(fetchDto('/meetings/missing')).rejects.toMatchObject({
    code: 'MEETING_NOT_FOUND',
    status: 404,
  })
})

// BE test_list_keeps_only_reupload_manual_upload_failures 와 같은 표다 (#598)
it.each([
  ['manual_upload', 'speaker_assignment_expired', true],
  ['manual_upload', 'upload_unclaimed', true],
  ['manual_upload', 'diarize', false],
  ['manual_upload', 'STT', false],
  ['manual_upload', null, false],
  ['manual_upload', 'future_stage', false],
  ['discord', 'speaker_assignment_expired', false],
  ['chat', 'upload_unclaimed', false],
] as const)(
  'lists a failed %s meeting with failed_stage=%s only when PM must re-upload: %s',
  async (source, stage, listed) => {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
    Object.assign(meeting, { status: 'failed', failed_stage: stage })
    db.meetingSummaries.find(({ meeting_id }) => meeting_id === 'mt_10')!.source = source
    const { items } = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
    const item = items.find(({ meeting_id }) => meeting_id === 'mt_10')
    expect(
      item === undefined ? null : { status: item.status, failed_stage: item.failed_stage },
    ).toEqual(listed ? { status: 'failed', failed_stage: stage } : null)
    expect(await fetchDto<MeetingDto>('/meetings/mt_10')).toMatchObject({ failed_stage: stage })
  },
)

it('keeps an unclaimed upload in its own workspace list only', async () => {
  const mt10 = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
  const summary = db.meetingSummaries.find(({ meeting_id }) => meeting_id === 'mt_10')!
  db.meetings.push({
    ...mt10,
    meeting_id: 'mt_90',
    workspace_id: 'ws_02',
    status: 'failed',
    failed_stage: 'upload_unclaimed',
  })
  db.meetingSummaries.push({ ...summary, meeting_id: 'mt_90', status: 'failed' })
  const ids = async (workspaceId: string) =>
    (await fetchDto<ListDto<MeetingSummaryDto>>(`/workspaces/${workspaceId}/meetings`)).items.map(
      ({ meeting_id }) => meeting_id,
    )
  expect(await ids('ws_02')).toEqual(['mt_90'])
  expect(await ids('ws_01')).not.toContain('mt_90')
})

it('creates and ends a bot meeting once', async () => {
  // 봇 경로라 FE 스키마가 없다. 이 검사가 읽는 필드만 적는다
  const created = await fetchDto<{ meeting_id: string; workspace_id: string; status: string }>(
    '/meetings',
    jsonRequest('POST', { workspace_id: 'ws_01' }),
  )
  expect(created).toMatchObject({ status: 'created', workspace_id: 'ws_01' })
  expect(toMeeting(await fetchDto<MeetingDto>(`/meetings/${created.meeting_id}`)).title).toBe('')
  const ended = await fetchDto<{ status: string }>(`/meetings/${created.meeting_id}/end`, {
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

it('rejects incomplete multipart requests but accepts uploads without Notion (D-182)', async () => {
  await expect(
    fetchDto('/workspaces/ws_01/meetings/upload', jsonRequest('POST', {})),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  db.meetings[2].status = 'done'
  for (const status of ['not_connected', 'revoked'] as const) {
    db.integrations.ws_01.notion.status = status
    const uploaded = await fetchDto<MeetingUploadDto>(
      '/workspaces/ws_01/meetings/upload',
      uploadBody(),
    )
    expect(uploaded).toMatchObject({ status: 'processing' })
    db.meetings.find(({ meeting_id }) => meeting_id === uploaded.meeting_id)!.status = 'done'
  }
})
