import { File as NodeFile } from 'node:buffer'
import type { RequestOptions } from '@/shared/api/client'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ListDto } from '@/shared/types/api/envelope'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { MeetingDto, MeetingSummaryDto, MeetingUploadDto } from '@/shared/types/api/meeting'
import type { MinutesDto } from '@/shared/types/api/minutes'
import type { TaskDto } from '@/shared/types/api/task'
import { db, initialDb } from './db'
import type { MeetingFlowMode } from './db'
import { advanceMeeting, completeMeeting, failMeeting, setMeetingFlowMode } from './meetingFlow'

// 업로드 본문을 jsdom File 로 만들고, Undici 파서를 위해 전역만 Node File 로 바꾼다 (meeting.integration.test.ts)
const BrowserFile = globalThis.File
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => vi.unstubAllGlobals())

function uploadBody(attendees: string[], content = 'audio'): RequestOptions {
  const form = new FormData()
  form.append('title', '업로드 회의')
  form.append('started_at', '2026-09-17T05:00:00Z')
  for (const id of attendees) form.append('attendee_member_ids', id)
  form.append('file', new BrowserFile([content], 'upload.mp3', { type: 'audio/mpeg' }))
  return { method: 'POST', body: form }
}

/** 픽스처의 처리 중 회의(mt_10)를 끝내고 새로 올린다. 새 회의 ID 를 돌려준다 */
async function upload(attendees = ['mb_02', 'mb_03']): Promise<string> {
  completeMeeting('mt_10')
  const { meeting_id } = await fetchDto<MeetingUploadDto>(
    '/workspaces/ws_01/meetings/upload',
    uploadBody(attendees),
  )
  return meeting_id
}

const detail = (id: string) => fetchDto<MeetingDto>(`/meetings/${id}`)
const listed = async () =>
  (await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')).items

describe('정리 완료 — 회의록·추출·태스크·승인이 같은 ID 로 이어진다 (U2-1)', () => {
  it('완료하면 회의는 done 이고 추출 결과를 가리킨다', async () => {
    const id = await upload()
    const { extraction } = completeMeeting(id)
    await expect(detail(id)).resolves.toMatchObject({
      status: 'done',
      extraction_id: extraction.extraction_id,
      failed_stage: null,
      progress: { audio_merged: true, transcribed: true, extracted: true },
    })
    const summary = (await listed()).find(({ meeting_id }) => meeting_id === id)
    expect(summary).toMatchObject({ status: 'done', source: 'manual_upload', attendee_count: 2 })
  })

  it('회의록 본문은 업로드한 참석자로 만들고 제목·날짜는 업로드 값이다', async () => {
    const id = await upload(['mb_02', 'mb_03'])
    completeMeeting(id)
    const minutes = await fetchDto<MinutesDto>(`/meetings/${id}/minutes`)
    expect(minutes).toMatchObject({
      meeting_id: id,
      title: '업로드 회의',
      started_at: '2026-09-17T05:00:00Z',
      source: 'manual_upload',
      attendees: [
        { member_id: 'mb_02', display_name: '박민수' },
        { member_id: 'mb_03', display_name: '이재환' },
      ],
      permissions: { can_review: true, can_undo: true },
    })
    expect(minutes.summary).not.toBeNull()
    expect(minutes.transcript.length).toBeGreaterThan(0)
    for (const line of minutes.transcript)
      expect(['mb_02', 'mb_03']).toContain(line.speaker_member_id)
  })

  it('확실한 항목은 그 회의의 태스크, 확인 필요 항목은 그 항목을 가리키는 대기 승인이다', async () => {
    const id = await upload()
    const completed = completeMeeting(id)
    const extraction = await fetchDto<ExtractionDto>(
      `/extractions/${completed.extraction.extraction_id}`,
    )
    expect(extraction.meeting_id).toBe(id)
    expect(extraction.items.map(({ gate }) => gate)).toEqual(['auto', 'review', 'hold'])

    const [auto, ...unresolved] = extraction.items
    expect(auto.approval_id).toBeNull()
    expect(completed.taskIds).toEqual([auto.task_id])
    await expect(fetchDto<TaskDto>(`/tasks/${auto.task_id}`)).resolves.toMatchObject({
      workspace_id: 'ws_01',
      meeting_id: id,
      title: auto.task.title,
      assignee_member_id: auto.assignee.member_id,
      // 확실한 항목은 즉시 Notion 에 반영된다 (D-101)
      notion_page_id: `notion_${auto.task_id}`,
    })

    const pending = await fetchDto<ListDto<ApprovalDto>>(
      '/approvals?workspace_id=ws_01&status=pending',
    )
    for (const item of unresolved) {
      expect(item.task_id).toBeNull()
      const approval = pending.items.find(({ approval_id }) => approval_id === item.approval_id)
      expect(approval).toMatchObject({
        workspace_id: 'ws_01',
        type: 'task_create',
        status: 'pending',
        payload: { extraction_item_id: item.item_id, meeting_id: id, task_title: item.task.title },
      })
    }
    expect(completed.approvalIds).toEqual(unresolved.map(({ approval_id }) => approval_id))
  })

  it('생성한 승인을 승인하면 기존 승인 경로가 그 항목에 태스크를 잇는다', async () => {
    const id = await upload()
    const { extraction, approvalIds } = completeMeeting(id)
    const approved = await fetchDto<ApprovalDto>(
      `/approvals/${approvalIds[0]}`,
      jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
    )
    const item = (await fetchDto<ExtractionDto>(`/extractions/${extraction.extraction_id}`))
      .items[1]
    expect(item.task_id).toBe(approved.related_task_id)
    await expect(fetchDto<TaskDto>(`/tasks/${item.task_id}`)).resolves.toMatchObject({
      meeting_id: id,
    })
  })

  it('생성 ID 는 픽스처 ID 와 겹치지 않는다', async () => {
    const id = await upload()
    const { extraction, taskIds, approvalIds } = completeMeeting(id)
    const fixtures = initialDb()
    expect(fixtures.extractions.map(({ extraction_id }) => extraction_id)).not.toContain(
      extraction.extraction_id,
    )
    for (const taskId of taskIds)
      expect(fixtures.tasks.map(({ task_id }) => task_id)).not.toContain(taskId)
    for (const approvalId of approvalIds)
      expect(fixtures.approvals.map(({ approval_id }) => approval_id)).not.toContain(approvalId)
  })
})

describe('진행 단계 (U2-2)', () => {
  it('한 단계씩 audio_merged → transcribed → extracted 가 켜지고 다음 진행이 완료다', async () => {
    const id = await upload()
    const progress = async () => (await detail(id)).progress
    await expect(progress()).resolves.toEqual({
      audio_merged: false,
      transcribed: false,
      extracted: false,
    })
    advanceMeeting(id)
    await expect(progress()).resolves.toEqual({
      audio_merged: true,
      transcribed: false,
      extracted: false,
    })
    advanceMeeting(id)
    await expect(progress()).resolves.toEqual({
      audio_merged: true,
      transcribed: true,
      extracted: false,
    })
    advanceMeeting(id)
    await expect(detail(id)).resolves.toMatchObject({
      status: 'processing',
      extraction_id: null,
      progress: { audio_merged: true, transcribed: true, extracted: true },
    })
    advanceMeeting(id)
    await expect(detail(id)).resolves.toMatchObject({ status: 'done' })
  })

  it('실패는 지금까지의 단계를 그대로 두고 결과를 만들지 않는다', async () => {
    const id = await upload()
    advanceMeeting(id)
    const before = {
      minutes: db.minutes.length,
      extractions: db.extractions.length,
      tasks: db.tasks.length,
      approvals: db.approvals.length,
    }
    failMeeting(id)
    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      extraction_id: null,
      progress: { audio_merged: true, transcribed: false, extracted: false },
    })
    expect({
      minutes: db.minutes.length,
      extractions: db.extractions.length,
      tasks: db.tasks.length,
      approvals: db.approvals.length,
    }).toEqual(before)
    // 실패 회의는 목록에 없다 (D-093)
    expect((await listed()).map(({ meeting_id }) => meeting_id)).not.toContain(id)
  })

  it('처리 중이 아닌 회의를 진행하려 하면 테스트를 멈춘다', () => {
    expect(() => advanceMeeting('mt_09')).toThrow(/not processing/)
    expect(() => completeMeeting('missing')).toThrow(/missing/)
  })
})

describe('Vitest 기본 계약은 상태를 명시적으로 제어한다 (U2-3)', () => {
  it('기본 흐름은 manual 이다 — 몇 번을 조회해도 처리 중 회의가 저절로 바뀌지 않는다', async () => {
    expect(db.meetingFlow.mode).toBe('manual')
    for (let poll = 0; poll < 5; poll += 1) await detail('mt_10')
    await expect(detail('mt_10')).resolves.toMatchObject({
      status: 'processing',
      progress: { audio_merged: true, transcribed: false, extracted: false },
    })
  })

  it('시간이 흘러도 바뀌지 않는다', async () => {
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(60 * 60_000)
    } finally {
      vi.useRealTimers()
    }
    await expect(detail('mt_10')).resolves.toMatchObject({ status: 'processing' })
  })
})

describe('흐름 방식 — 상세 조회가 진행시킨다', () => {
  it('staged 는 조회마다 한 단계, 네 번째 조회에 done 이다', async () => {
    const id = await upload()
    setMeetingFlowMode('staged')
    const seen: string[] = []
    for (let poll = 0; poll < 4; poll += 1) {
      const meeting = await detail(id)
      const progress = meeting.progress ?? {
        audio_merged: false,
        transcribed: false,
        extracted: false,
      }
      seen.push(
        `${meeting.status}:${Number(progress.audio_merged)}${Number(progress.transcribed)}${Number(progress.extracted)}`,
      )
    }
    expect(seen).toEqual(['processing:100', 'processing:110', 'processing:111', 'done:111'])
  })

  it('instant 는 첫 조회에 done 이고 회의록을 바로 읽을 수 있다', async () => {
    const id = await upload()
    setMeetingFlowMode('instant')
    const meeting = await detail(id)
    expect(meeting.status).toBe('done')
    expect(meeting.extraction_id).not.toBeNull()
    await expect(fetchDto<MinutesDto>(`/meetings/${id}/minutes`)).resolves.toMatchObject({
      attendees: [{ member_id: 'mb_02' }, { member_id: 'mb_03' }],
    })
  })

  it.each<[MeetingFlowMode, string]>([
    ['fail', 'connected'],
    ['fail-notion-revoked', 'revoked'],
  ])('%s 는 첫 조회에 failed 이고 Notion 은 %s 다', async (mode, notion) => {
    const id = await upload()
    setMeetingFlowMode(mode)
    await expect(detail(id)).resolves.toMatchObject({ status: 'failed' })
    await expect(
      fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations'),
    ).resolves.toMatchObject({ notion: { status: notion } })
    expect((await listed()).map(({ meeting_id }) => meeting_id)).not.toContain(id)
  })

  it('끝난 회의는 어떤 방식에서도 다시 바뀌지 않는다', async () => {
    setMeetingFlowMode('fail')
    await expect(detail('mt_09')).resolves.toMatchObject({ status: 'done' })
  })
})
