import { http } from 'msw'
import { ApiError } from '@/shared/api/errors'
import { fail } from '@/shared/mock/envelope'
import { meetingFixtures, meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'
import { MOCK_SCENARIOS, applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import type { MockScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import { extractionSchema } from './extraction'
import {
  meetingListSchema,
  meetingSchema,
  meetingSummarySchema,
  meetingUploadResponseSchema,
  speakerViewSchema,
} from './meeting'
import { minutesSchema } from './minutes'

const summary = meetingSummaryFixtures[0]
const detail = meetingFixtures[0]

describe('회의 스키마', () => {
  it('모르는 출처는 거절하지 않는다. 화면이 알 수 없는 출처로 읽는다', () => {
    expect(meetingSummarySchema.safeParse({ ...summary, source: 'zoom' }).success).toBe(true)
  })

  it.each([
    ['목록의 모르는 상태', meetingSummarySchema, { ...summary, status: 'archived' }],
    ['목록의 null 상태', meetingSummarySchema, { ...summary, status: null }],
    ['목록의 숫자 참석자 수가 아님', meetingSummarySchema, { ...summary, attendee_count: '3' }],
    ['상세의 모르는 상태', meetingSchema, { ...detail, status: 'archived' }],
    ['상세의 필수 필드 누락', meetingSchema, { ...detail, workspace_id: undefined }],
    ['문자열 삭제 가능 여부', meetingSchema, { ...detail, deletion_available: 'true' }],
    [
      '불리언이 아닌 진행 단계',
      meetingSchema,
      { ...detail, progress: { ...detail.progress, transcribed: 1 } },
    ],
    [
      '업로드의 모르는 상태',
      meetingUploadResponseSchema,
      { meeting_id: 'mt_20', status: 'queued' },
    ],
  ])('%s 는 읽지 않는다', (_, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })

  it('삭제 가능 여부·진행 단계·실패 단계가 빠진 옛 응답도 읽는다', () => {
    const legacy: Partial<typeof detail> = { ...detail }
    delete legacy.deletion_available
    delete legacy.progress
    expect(meetingSchema.safeParse(legacy).success).toBe(true)
    const listLegacy: Partial<typeof summary> = { ...summary }
    delete listLegacy.failed_stage
    expect(meetingSummarySchema.safeParse(listLegacy).success).toBe(true)
  })

  describe('정리 중 처리 단계 (#483)', () => {
    const processing = {
      stage: 'stt',
      stage_at: '2026-09-18T00:00:00Z',
      stt: { done: 3, total: 5 },
    }

    it('진행 수·단계·시각을 읽고, 없는 키(#542 전 서버)는 없는 그대로다', () => {
      expect(meetingSchema.parse({ ...detail, processing }).processing).toEqual(processing)
      expect(meetingSchema.parse({ ...detail, processing: null }).processing).toBeNull()
      expect(meetingSchema.parse(detail)).not.toHaveProperty('processing')
    })

    it.each([
      ['끝낸 수가 전체보다 많음', { ...processing, stt: { done: 6, total: 5 } }],
      ['전체가 0', { ...processing, stt: { done: 0, total: 0 } }],
      ['정수가 아닌 진행 수', { ...processing, stt: { done: 1.5, total: 5 } }],
      ['문자열 진행', { ...processing, stt: '3/5' }],
      ['숫자 단계', { ...processing, stage: 1 }],
      ['문자열 processing', 'stt'],
    ])('%s 은 응답을 거절하지 않고 처리 단계만 없는 것으로 본다', (_, value) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const parsed = meetingSchema.safeParse({ ...detail, processing: value })
        expect(parsed.success).toBe(true)
        expect(parsed.data?.processing).toBeNull()
        expect(parsed.data?.meeting_id).toBe(detail.meeting_id)
      } finally {
        warning.mockRestore()
      }
    })
  })

  it('목록 한 건이 모르는 상태면 목록 전체를 읽지 않는다', () => {
    const result = meetingListSchema.safeParse({
      items: [summary, { ...summary, meeting_id: 'mt_99', status: 'archived' }],
    })
    expect(result.error?.issues[0]?.path).toEqual(['items', 1, 'status'])
  })

  describe('화자 지정', () => {
    const view = {
      meeting_id: 'mt_20',
      status: 'awaiting_speakers',
      speakers: [{ label: 'SPEAKER_00', total_sec: 12.5, samples: [{ start: 0, end: 4 }] }],
      candidates: [{ member_id: 'mb_01', display_name: '김서연' }],
      mapping: { SPEAKER_00: 'mb_01', SPEAKER_01: null },
      audio: null,
    }

    it('지정 전(null)·외부 참석자(null)·녹음 없음(null)을 읽는다', () => {
      expect(speakerViewSchema.parse(view).mapping).toEqual({
        SPEAKER_00: 'mb_01',
        SPEAKER_01: null,
      })
      expect(speakerViewSchema.safeParse({ ...view, mapping: null }).success).toBe(true)
    })

    it.each([
      ['팀원 ID 가 숫자인 지정', { mapping: { SPEAKER_00: 1 } }],
      ['배열 지정', { mapping: ['mb_01'] }],
      ['모르는 상태', { status: 'diarizing' }],
    ])('%s 은 읽지 않는다', (_, patch) => {
      expect(speakerViewSchema.safeParse({ ...view, ...patch }).success).toBe(false)
    })
  })
})

interface Checked {
  details: number
  minutes: number
  extractions: number
  speakers: number
}

/** 볼 수 없는 회의(다른 사람의 403, 없는 회의 404)만 건너뛴다. 그 밖의 실패는 스키마 검사를 건너뛴 것이라 다시 던진다 */
function isNotViewable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && [403, 404].includes(error.status)
}

/** 이 공간의 회의를 화면이 부르는 순서로 모두 받아 스키마로 읽는다. 실제로 읽은 응답 수를 돌려준다 */
async function readMeetings(workspaceId: string): Promise<Checked> {
  const checked: Checked = { details: 0, minutes: 0, extractions: 0, speakers: 0 }
  const list = meetingListSchema.parse(await fetchDto(`/workspaces/${workspaceId}/meetings`))
  for (const { meeting_id, status } of list.items) {
    let meeting
    try {
      meeting = meetingSchema.parse(await fetchDto(`/meetings/${meeting_id}`))
    } catch (error) {
      if (isNotViewable(error)) continue
      throw error
    }
    checked.details += 1
    if (status === 'done') {
      minutesSchema.parse(await fetchDto(`/meetings/${meeting_id}/minutes`))
      checked.minutes += 1
    }
    if (meeting.extraction_id !== null) {
      extractionSchema.parse(await fetchDto(`/extractions/${meeting.extraction_id}`))
      checked.extractions += 1
    }
    if (status === 'awaiting_speakers') {
      try {
        speakerViewSchema.parse(await fetchDto(`/meetings/${meeting_id}/speakers`))
        checked.speakers += 1
      } catch (error) {
        // 팀원은 403 이다
        if (!(error instanceof ApiError && error.kind === 'http' && error.status === 403))
          throw error
      }
    }
  }
  return checked
}

describe('MSW 픽스처가 같은 스키마를 따른다', () => {
  it('회의 픽스처', () => {
    for (const meeting of meetingFixtures) meetingSchema.parse(meeting)
    for (const meeting of meetingSummaryFixtures) meetingSummarySchema.parse(meeting)
  })

  const scenarios: (MockScenario | null)[] = [
    null,
    ...MOCK_SCENARIOS.filter((scenario) => scenario.startsWith('meeting-')),
    'minutes-edit-pending',
    'minutes-awaiting-approval',
    'minutes-awaiting-approval-member',
    'dashboard-default',
    'dashboard-recent-overflow',
    'dashboard-revert-rejected',
    'approval-merged',
    'approval-chat',
    'reply-judgment',
  ]

  const total: Checked = { details: 0, minutes: 0, extractions: 0, speakers: 0 }

  it.each(scenarios)(
    '%s 상태에서 handler 가 내는 회의 목록·상세·회의록·추출·화자 지정',
    async (scenario) => {
      if (scenario !== null) applyScenario(scenario)
      const checked = await readMeetings('ws_01')
      expect(checked.details).toBeGreaterThan(0)
      for (const key of Object.keys(total) as (keyof Checked)[]) total[key] += checked[key]
    },
  )

  it('위 상태들에서 회의록·추출·화자 지정 응답도 실제로 읽었다', () => {
    expect(total.minutes).toBeGreaterThan(0)
    expect(total.extractions).toBeGreaterThan(0)
    expect(total.speakers).toBeGreaterThan(0)
  })

  it('상세가 403·404 가 아닌 오류면 건너뛰지 않고 실패한다', async () => {
    server.use(http.get('/api/v1/meetings/:meetingId', () => fail('INTERNAL_ERROR', '오류', 500)))
    await expect(readMeetings('ws_01')).rejects.toMatchObject({ status: 500 })
  })
})
