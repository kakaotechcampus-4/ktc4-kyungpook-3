import { File as NodeFile } from 'node:buffer'
import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type {
  MeetingDto,
  MeetingSummaryDto,
  MeetingUploadDto,
  SpeakerViewDto,
} from '@/shared/types/api/meeting'
import { db } from './db'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'
import { AWAITING_MEETING_ID } from './speakerScenarios'

const BrowserFile = globalThis.File
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => vi.unstubAllGlobals())

const view = (id = AWAITING_MEETING_ID) => fetchDto<SpeakerViewDto>(`/meetings/${id}/speakers`)
const assign = (mapping: Record<string, string | null>, id = AWAITING_MEETING_ID) =>
  fetchDto<{ meeting_id: string; status: string }>(
    `/meetings/${id}/speakers`,
    jsonRequest('PUT', { mapping }),
  )
const detail = (id = AWAITING_MEETING_ID) => fetchDto<MeetingDto>(`/meetings/${id}`)
const ALL_ASSIGNED = { SPEAKER_00: 'mb_01', SPEAKER_01: 'mb_01', SPEAKER_02: null }

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ApiError)) throw new Error('expected an ApiError')
  return { status: error.status, code: error.code, details: error.details }
}

describe('화자 지정 MSW (계약 §2.3.1)', () => {
  it('대기 중 회의는 라벨을 말한 시간 많은 순으로, 후보는 업로드 참석자로 준다', async () => {
    applyScenario('meeting-speakers')
    const { speakers, candidates, mapping, audio, status } = await view()
    expect(status).toBe('awaiting_speakers')
    expect(speakers.map(({ label, samples }) => [label, samples.length])).toEqual([
      ['SPEAKER_00', 3],
      ['SPEAKER_01', 1],
      ['SPEAKER_02', 1],
    ])
    expect(speakers[2].samples[0].end - speakers[2].samples[0].start).toBeCloseTo(0.8)
    expect(candidates.map(({ member_id }) => member_id)).toEqual(['mb_01', 'mb_02', 'mb_03'])
    expect(mapping).toBeNull()
    expect(audio).toMatchObject({ content_type: 'audio/wav' })
  })

  it('목록과 상세가 화자 지정 대기 상태를 보인다', async () => {
    applyScenario('meeting-speakers')
    const { items } = await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')
    expect(items.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)).toMatchObject({
      status: 'awaiting_speakers',
      source: 'manual_upload',
    })
    await expect(detail()).resolves.toMatchObject({ status: 'awaiting_speakers' })
  })

  it('지정을 내면 처리 중으로 돌아가고, 같은 지정을 다시 내도 200 이다', async () => {
    applyScenario('meeting-speakers')
    await expect(assign(ALL_ASSIGNED)).resolves.toEqual({
      meeting_id: AWAITING_MEETING_ID,
      status: 'processing',
    })
    await expect(assign(ALL_ASSIGNED)).resolves.toMatchObject({ status: 'processing' })
    await expect(view()).resolves.toMatchObject({ mapping: ALL_ASSIGNED })
  })

  it('다른 지정을 다시 내면 409 와 지금 상태다', async () => {
    applyScenario('meeting-speakers')
    await assign(ALL_ASSIGNED)
    await expect(rejection(assign({ ...ALL_ASSIGNED, SPEAKER_02: 'mb_02' }))).resolves.toEqual({
      status: 409,
      code: 'MEETING_NOT_AWAITING_SPEAKERS',
      details: { meeting_id: AWAITING_MEETING_ID, status: 'processing' },
    })
  })

  it('라벨이 빠지거나 모르는 라벨, 없는 팀원은 400 details 이고 아무것도 바꾸지 않는다', async () => {
    applyScenario('meeting-speakers')
    await expect(
      rejection(assign({ SPEAKER_00: 'mb_01', SPEAKER_01: 'mb_99', SPEAKER_09: null })),
    ).resolves.toEqual({
      status: 400,
      code: 'INVALID_REQUEST',
      details: {
        unknown_labels: ['SPEAKER_09'],
        missing_labels: ['SPEAKER_02'],
        member_ids: ['mb_99'],
      },
    })
    await expect(detail()).resolves.toMatchObject({ status: 'awaiting_speakers' })
  })

  it('PM 이 아니면 403, 업로드 회의가 아니거나 없으면 404 다', async () => {
    applyScenario('meeting-speakers')
    await expect(rejection(view('mt_09'))).resolves.toMatchObject({ status: 404 })
    await expect(rejection(view('mt_404'))).resolves.toMatchObject({ status: 404 })
    setMockRole('member')
    await expect(rejection(view())).resolves.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    await expect(rejection(assign(ALL_ASSIGNED))).resolves.toMatchObject({ status: 403 })
  })

  it('기한이 지난 회의에 내면 409 status=failed, 상세는 speaker_assignment_expired 다', async () => {
    applyScenario('meeting-speakers-expired')
    await expect(rejection(assign(ALL_ASSIGNED))).resolves.toMatchObject({
      status: 409,
      details: { status: 'failed' },
    })
    await expect(detail()).resolves.toMatchObject({
      status: 'failed',
      failed_stage: 'speaker_assignment_expired',
    })
    await expect(view()).resolves.toMatchObject({ audio: null })
  })

  it('녹음이 없으면 audio 가 null 이고 재생 경로가 404 다', async () => {
    applyScenario('meeting-speakers-no-audio')
    await expect(view()).resolves.toMatchObject({ audio: null })
    const response = await fetch(
      new URL(`/api/v1/meetings/${AWAITING_MEETING_ID}/audio`, window.location.origin),
    )
    expect(response.status).toBe(404)
  })

  it('녹음은 봉투 없는 WAV 이고 Range 에 206 으로 답한다', async () => {
    applyScenario('meeting-speakers')
    const url = new URL(`/api/v1/meetings/${AWAITING_MEETING_ID}/audio`, window.location.origin)
    const whole = await fetch(url)
    expect(whole.headers.get('content-type')).toBe('audio/wav')
    const bytes = new Uint8Array(await whole.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    const { audio } = await view()
    expect(bytes.byteLength).toBe(audio?.size_bytes)
    const part = await fetch(url, { headers: { Range: 'bytes=0-3' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 0-3/${bytes.byteLength}`)
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(0, 4))
  })

  it('업로드 흐름: 첫 조회에 대기, 지정 뒤 조회마다 한 단계씩 끝난다', async () => {
    applyScenario('meeting-speakers-flow')
    const form = new FormData()
    form.append('title', '화자 데모')
    form.append('started_at', '2026-09-20T01:00:00Z')
    form.append('attendee_member_ids', 'mb_01')
    form.append('attendee_member_ids', 'mb_02')
    form.append('file', new BrowserFile(['x'], 'demo.wav', { type: 'audio/wav' }))
    const { meeting_id: id } = await fetchDto<MeetingUploadDto>(
      '/workspaces/ws_01/meetings/upload',
      { method: 'POST', body: form },
    )
    await expect(view(id)).resolves.toMatchObject({ status: 'processing', speakers: [] })
    await expect(detail(id)).resolves.toMatchObject({ status: 'awaiting_speakers' })
    await expect(detail(id)).resolves.toMatchObject({ status: 'awaiting_speakers' })
    const { candidates } = await view(id)
    expect(candidates.map(({ member_id }) => member_id)).toEqual(['mb_01', 'mb_02'])
    await assign(ALL_ASSIGNED, id)
    const statuses = []
    for (let poll = 0; poll < 3; poll += 1) statuses.push((await detail(id)).status)
    expect(statuses).toEqual(['processing', 'processing', 'done'])
    expect(db.meetingFlow.speakers[id].mapping).toEqual(ALL_ASSIGNED)
  })
})
