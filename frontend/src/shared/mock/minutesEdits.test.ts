import type { MinutesDto } from '@/shared/types/api/minutes'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { db } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { purgeMeeting } from './meetingDeletion'
import { setMockRole } from './sessions'

/* 회의 기록 고치기 MSW 가 BE #669 와 같게 답하는가 (services/transcript.py, schemas/record_edit.py, 계약 §4.4.3) */

const minutes = () => fetchDto<MinutesDto>('/meetings/mt_09/minutes')
const patchTitle = (title: unknown) =>
  fetchDto('/meetings/mt_09/title', jsonRequest('PATCH', { title }))
const patchLine = (seq: number | string, text: unknown) =>
  fetchDto(`/meetings/mt_09/transcript/${seq}`, jsonRequest('PATCH', { text }))

describe('제목', () => {
  it('일반 팀원도 고친다. 앞뒤 공백을 빼고 처음 제목을 남기며 목록도 고친 제목이다', async () => {
    setMockRole('member')
    await expect(patchTitle('  3주차 회의 ')).resolves.toEqual({
      meeting_id: 'mt_09',
      title: '3주차 회의',
      title_original: '3주차 정기회의',
      title_edited: true,
    })
    await expect(patchTitle('또 고친 제목')).resolves.toMatchObject({
      title_original: '3주차 정기회의',
    })
    await expect(minutes()).resolves.toMatchObject({
      title: '또 고친 제목',
      title_edited: true,
      title_original: '3주차 정기회의',
    })
    const list = await fetchDto<{ items: { meeting_id: string; title: string }[] }>(
      '/workspaces/ws_01/meetings',
    )
    expect(list.items.find(({ meeting_id }) => meeting_id === 'mt_09')?.title).toBe('또 고친 제목')
  })

  it.each([null, '3주차 정기회의'])('%s 는 처음 제목으로 되돌린다', async (title) => {
    await patchTitle('고친 제목')
    await expect(patchTitle(title)).resolves.toEqual({
      meeting_id: 'mt_09',
      title: '3주차 정기회의',
      title_original: null,
      title_edited: false,
    })
  })

  it.each([[''], ['   '], ['가'.repeat(201)], ['a\u0000b'], [3]])(
    '%j 는 400 이다',
    async (title) => {
      await expect(patchTitle(title)).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
      })
    },
  )

  it('200자는 받는다(문자로 센다)', async () => {
    await expect(patchTitle('😀'.repeat(200))).resolves.toMatchObject({ title_edited: true })
  })
})

describe('발화', () => {
  it('원문을 두고 고친 문장을 주며, 같은 원문이나 null 은 되돌린다', async () => {
    await expect(patchLine(1, '고친 문장 ')).resolves.toEqual({
      seq: 1,
      text: '고친 문장 ',
      original_text: '회원가입 화면은 제가 맡겠습니다.',
      edited: true,
    })
    const read = await minutes()
    expect(read.transcript[1]).toMatchObject({
      seq: 1,
      text: '고친 문장 ',
      edited: true,
      original_text: '회원가입 화면은 제가 맡겠습니다.',
    })
    expect(read.transcript[0]).toMatchObject({ edited: false, original_text: null })
    await expect(patchLine(1, '회원가입 화면은 제가 맡겠습니다.')).resolves.toMatchObject({
      edited: false,
      original_text: null,
    })
    await patchLine(1, '다시 고침')
    await expect(patchLine(1, null)).resolves.toEqual({
      seq: 1,
      text: '회원가입 화면은 제가 맡겠습니다.',
      original_text: null,
      edited: false,
    })
  })

  it.each([[''], [' \n '], ['가'.repeat(10_001)]])('%j 는 400 이다', async (text) => {
    await expect(patchLine(1, text)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    })
  })

  it.each([5, -1, 99])('없는 줄 %s 는 404 TRANSCRIPT_LINE_NOT_FOUND 다', async (seq) => {
    await expect(patchLine(seq, '글')).rejects.toMatchObject({
      status: 404,
      code: 'TRANSCRIPT_LINE_NOT_FOUND',
    })
  })
})

it('삭제된 회의는 410, 없는 회의는 404, 비소속은 403 이다', async () => {
  db.meetingDeletions.push({
    meeting_id: 'mt_09',
    workspace_id: 'ws_01',
    deleted_at: MOCK_NOW,
    cleanup_status: 'complete',
    deleted_meeting_ids: ['mt_09'],
  })
  purgeMeeting('mt_09')
  await expect(patchTitle('제목')).rejects.toMatchObject({ status: 410, code: 'MEETING_DELETED' })
  await expect(patchLine(0, '글')).rejects.toMatchObject({ status: 410, code: 'MEETING_DELETED' })
  await expect(
    fetchDto('/meetings/mt_nope/title', jsonRequest('PATCH', { title: '제목' })),
  ).rejects.toMatchObject({ status: 404, code: 'MEETING_NOT_FOUND' })
  db.meetings.find(({ meeting_id }) => meeting_id === 'mt_07')!.workspace_id = 'ws_other'
  await expect(
    fetchDto('/meetings/mt_07/title', jsonRequest('PATCH', { title: '제목' })),
  ).rejects.toMatchObject({ status: 403 })
})

it('회의록 행이 없는 회의도 처음 제목을 회의에 남겨 다시 고치고 되돌린다', async () => {
  db.minutes = db.minutes.filter(({ meeting_id }) => meeting_id !== 'mt_09')
  await patchTitle('edited once')
  await expect(minutes()).resolves.toMatchObject({
    title: 'edited once',
    title_edited: true,
    title_original: '3주차 정기회의',
  })
  await expect(patchTitle('edited twice')).resolves.toMatchObject({
    title_original: '3주차 정기회의',
  })
  await expect(patchTitle(null)).resolves.toEqual({
    meeting_id: 'mt_09',
    title: '3주차 정기회의',
    title_original: null,
    title_edited: false,
  })
})

it('회의를 지우면 고친 제목 기록도 지운다', async () => {
  await patchTitle('고친 제목')
  purgeMeeting('mt_09')
  expect(db.titleEdits).toEqual({})
})
