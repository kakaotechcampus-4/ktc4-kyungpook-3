import { QueryClient } from '@tanstack/react-query'
import { File as NodeFile } from 'node:buffer'
import { http } from 'msw'
import type { UploadProgress } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import type { UploadMeetingInput } from '../model/types'
import { meetingDetailQueryOptions, meetingKeys, meetingListQueryOptions } from './meetingQueries'
import { toUploadForm, uploadMeeting } from './uploadMeeting'

// 화면이 넘기는 File 은 브라우저(jsdom) File 이다. 전역을 바꾸기 전에 잡아 둔다
const BrowserFile = globalThis.File

// Undici 의 multipart 파서는 Node File 을 요구한다 (meeting.integration.test.ts 와 같다)
beforeEach(() => vi.stubGlobal('File', NodeFile))
afterEach(() => vi.unstubAllGlobals())

function input(overrides: Partial<UploadMeetingInput> = {}): UploadMeetingInput {
  return {
    file: new BrowserFile(['audio'], '지난 회의.mp3', { type: 'audio/mpeg' }),
    title: '지난 회의.mp3',
    startedAt: '2026-09-14T05:00:00.000Z',
    attendeeMemberIds: ['mb_01', 'mb_02', 'mb_03'],
    ...overrides,
  }
}

const UPLOAD_PATH = '/api/v1/workspaces/ws_01/meetings/upload'

/** 이 테스트 동안 업로드 handler 에 닿은 요청 수와 multipart 필드를 순서대로 적는다 */
function recordUploads() {
  const forms: [string, string][][] = []
  let started = 0
  const onStart = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname !== UPLOAD_PATH) return
    started += 1
    void request
      .clone()
      .formData()
      .then((form) => {
        forms.push(
          [...form.entries()].map(([name, value]) => [
            name,
            // 파일 이름은 jsdom XHR → MSW 경로에서 'blob' 으로 바뀐다. 이름은 toUploadForm 테스트가 본다
            typeof value === 'string' ? value : '(file)',
          ]),
        )
      })
  }
  server.events.on('request:start', onStart)
  onTestFinished(() => {
    server.events.removeListener('request:start', onStart)
  })
  return { forms, started: () => started }
}

describe('meetingListQueryOptions', () => {
  it('key 에 workspaceId 가 있고 30초 동안 최신이다', () => {
    const options = meetingListQueryOptions('ws_01')
    expect(options.queryKey).toEqual(['workspace', 'ws_01', 'meetings', 'list'])
    expect(options.staleTime).toBe(STALE_TIME.default)
  })

  it('그 공간의 회의를 최신순 MeetingSummary[] 로 받는다 — 처리 중 회의도 온다', async () => {
    const meetings = await new QueryClient().fetchQuery(meetingListQueryOptions('ws_01'))
    expect(meetings.map(({ id, status }) => [id, status])).toEqual([
      ['mt_10', 'processing'],
      ['mt_09', 'done'],
      ['mt_07', 'done'],
    ])
  })
})

describe('meetingDetailQueryOptions', () => {
  it('key 에 workspaceId 가 있고 목록과 같은 회의 key 접두어 아래에 있다', () => {
    const { queryKey } = meetingDetailQueryOptions('ws_01', 'mt_10')
    expect(queryKey).toEqual(['workspace', 'ws_01', 'meetings', 'detail', 'mt_10'])
    expect(queryKey.slice(0, 3)).toEqual(meetingKeys('ws_01'))
    expect(meetingListQueryOptions('ws_01').queryKey.slice(0, 3)).toEqual(meetingKeys('ws_01'))
  })

  it('상세를 Meeting 으로 받는다 — 진행 단계와 공간 ID 가 있다', async () => {
    const meeting = await new QueryClient().fetchQuery(meetingDetailQueryOptions('ws_01', 'mt_10'))
    expect(meeting).toMatchObject({
      id: 'mt_10',
      workspaceId: 'ws_01',
      status: 'processing',
      progress: { audioMerged: true, transcribed: false, extracted: false },
    })
  })
})

describe('toUploadForm', () => {
  it('계약의 필드 이름을 쓰고 참석자는 같은 이름 필드를 참석자 수만큼 반복한다', () => {
    const form = toUploadForm(input())
    expect([...form.keys()]).toEqual([
      'title',
      'started_at',
      'attendee_member_ids',
      'attendee_member_ids',
      'attendee_member_ids',
      'file',
    ])
    expect(form.getAll('attendee_member_ids')).toEqual(['mb_01', 'mb_02', 'mb_03'])
    expect(form.get('started_at')).toBe('2026-09-14T05:00:00.000Z')
    const file = form.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect(file instanceof Blob && 'name' in file ? file.name : null).toBe('지난 회의.mp3')
  })
})

describe('uploadMeeting', () => {
  beforeEach(() => {
    // 픽스처의 처리 중 회의가 있으면 409 다. 정상 업로드를 보려면 끝내 둔다 (msw-guide)
    db.meetings[2].status = 'done'
  })

  it('서버가 참석자 3명을 같은 이름 필드 3개로 받고 202 processing 회의를 돌려준다', async () => {
    const uploads = recordUploads()
    const result = await uploadMeeting('ws_01', input())
    expect(result).toEqual({ id: expect.stringMatching(/^mt_/) as unknown, status: 'processing' })

    await vi.waitFor(() => expect(uploads.forms).toHaveLength(1))
    expect(uploads.forms[0]).toEqual([
      ['title', '지난 회의.mp3'],
      ['started_at', '2026-09-14T05:00:00.000Z'],
      ['attendee_member_ids', 'mb_01'],
      ['attendee_member_ids', 'mb_02'],
      ['attendee_member_ids', 'mb_03'],
      ['file', '(file)'],
    ])
    // handler 가 getAll 로 읽은 값 — 하나만 잡히지 않았다
    expect(db.meetingFlow.attendees[result.id]).toEqual(['mb_01', 'mb_02', 'mb_03'])
    expect(db.meetings.find(({ meeting_id }) => meeting_id === result.id)).toMatchObject({
      title: '지난 회의.mp3',
      started_at: '2026-09-14T05:00:00.000Z',
      status: 'processing',
    })
  })

  it('참석자 한 명도 같은 규칙이다', async () => {
    const uploads = recordUploads()
    await uploadMeeting('ws_01', input({ attendeeMemberIds: ['mb_04'] }))
    await vi.waitFor(() => expect(uploads.forms).toHaveLength(1))
    expect(uploads.forms[0].filter(([name]) => name === 'attendee_member_ids')).toEqual([
      ['attendee_member_ids', 'mb_04'],
    ])
  })

  it('전송 진행을 UploadProgress 로 알린다', async () => {
    const seen: UploadProgress[] = []
    await uploadMeeting('ws_01', input(), { onProgress: (progress) => seen.push(progress) })
    expect(seen.length).toBeGreaterThan(0)
    for (const { loaded, total } of seen) {
      expect(loaded).toBeGreaterThanOrEqual(0)
      if (total !== null) expect(loaded).toBeLessThanOrEqual(total)
    }
  })

  it('처리 중 회의가 있으면 409 와 그 회의 ID 를 그대로 던지고 다시 보내지 않는다', async () => {
    db.meetings[2].status = 'processing'
    const uploads = recordUploads()
    await expect(uploadMeeting('ws_01', input())).rejects.toMatchObject({
      code: 'MEETING_PROCESSING_IN_PROGRESS',
      status: 409,
      details: { meeting_id: 'mt_10' },
    })
    expect(uploads.started()).toBe(1)
  })

  it('413 은 AUDIO_TOO_LARGE 로 던진다 — 실 API 가 아직 검사하지 않아 override 로 본다', async () => {
    server.use(
      http.post('/api/v1/workspaces/:workspaceId/meetings/upload', () =>
        fail('AUDIO_TOO_LARGE', '파일이 너무 큽니다.', 413),
      ),
    )
    await expect(uploadMeeting('ws_01', input())).rejects.toMatchObject({
      code: 'AUDIO_TOO_LARGE',
      status: 413,
    })
  })
})
