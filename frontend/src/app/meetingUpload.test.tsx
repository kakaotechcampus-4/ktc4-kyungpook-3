import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { File as NodeFile } from 'node:buffer'
import { HttpResponse, http } from 'msw'
import { clearTrackedMeetings, useMeetingTrackerStore } from '@/entities/meeting'
import { readAudioDuration } from '@/features/meeting-upload'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { completeMeeting } from '@/shared/mock/meetingFlow'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { isTrackerRequest, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M5 U3 — 회의 올리기. 실제 경로 표·가드·MSW handler·request() 를 그대로 탄다.
 * 길이 읽기만 바꿔 끼운다 — jsdom 은 미디어 메타데이터를 읽지 못한다. 실제 읽기와 object URL 해제는
 * features/meeting-upload/model/audioDuration.test.ts 가 가짜 오디오 요소로 본다.
 */
vi.mock('@/features/meeting-upload/model/audioDuration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/meeting-upload/model/audioDuration')>()),
  readAudioDuration: vi.fn(),
}))

// 화면이 다루는 File 은 브라우저(jsdom) File 이다. 전역을 바꾸기 전에 잡아 둔다
const BrowserFile = globalThis.File
const UPLOAD = '/api/v1/workspaces/ws_01/meetings/upload'
const UPLOAD_PATH = paths.meetingUpload('ws_01')
const NINE_AM_SEOUL = Date.parse('2026-09-09T00:30:00Z')
/* 처리 화면의 제목. U3 때는 자리표시자 `회의 정리 중` 이었고 U4 가 Processing 캔버스의 실제 화면으로 바꿨다 */
const PROCESSING_HEADING = '정리하고 있어요'

beforeEach(() => {
  // Undici 의 multipart 파서는 Node File 을 요구한다 (entities/meeting/api/meetingApi.test.ts 와 같다)
  vi.stubGlobal('File', NodeFile)
  vi.mocked(readAudioDuration)
    .mockReset()
    .mockResolvedValue(52 * 60_000 + 14_000)
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearTrackedMeetings()
})

function audio(name = '3주차 정기회의.m4a', lastModified = NINE_AM_SEOUL) {
  return new BrowserFile(['audio-bytes'], name, { type: 'audio/mp4', lastModified })
}

/** 업로드 handler 가 받은 multipart 필드. 기록만 하고 원래 handler 로 넘긴다 */
function recordUploads() {
  const forms: Record<string, string[]>[] = []
  server.use(
    http.post(UPLOAD, async ({ request }) => {
      const form = await request.clone().formData()
      const fields: Record<string, string[]> = {}
      for (const [name, value] of form.entries())
        (fields[name] ??= []).push(typeof value === 'string' ? value : '(file)')
      forms.push(fields)
      return undefined
    }),
  )
  return forms
}

/** 픽스처의 정리 중 회의를 끝내 업로드 화면에 들어올 수 있게 한다 */
async function openUpload(options: { strict?: boolean } = {}) {
  completeMeeting('mt_10')
  const user = userEvent.setup({ applyAccept: false })
  const app = renderApp(UPLOAD_PATH, options)
  await screen.findByRole('heading', { name: '회의를 올려 주세요' })
  await screen.findByRole('button', { name: '정리 시작하기' })
  return { user, app }
}

async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('녹음 파일'), file)
}

function drop(files: File[]) {
  fireEvent.drop(screen.getByTestId('audio-dropzone'), { dataTransfer: { files } })
}

async function addAttendee(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: '추가' }))
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(name) }))
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, file = audio()) {
  await choose(user, file)
  await waitFor(() => expect(screen.getByLabelText('회의 제목')).toHaveValue(file.name))
  await addAttendee(user, '김서연')
}

/** 원본 바이트를 쥐는 값(File·Blob·FormData)이 안에 있는가. 객체·배열을 끝까지 따라간다 */
function holdsBytes(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  seen.add(value)
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object File]' || tag === '[object Blob]' || tag === '[object FormData]') return true
  return Object.values(value).some((child) => holdsBytes(child, seen))
}

const uploadsIn = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'POST' && path.endsWith('/meetings/upload'))

describe('진입 (U3-1)', () => {
  it('정리 중 회의가 있으면 그 처리 화면으로 옮기고 연동 상태는 보지 않는다', async () => {
    const log = recordRequests()
    const app = renderApp(UPLOAD_PATH)
    expect(await screen.findByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_10'))
    // U4 부터 businessRequests() 는 추적기의 상시 요청(지금 공간 회의 목록·회의 상세)을 뺀다. 진입 판정의 목록 조회도
    // 같은 모양이라 전체 기록에서 본다 — 목록은 받았고 연동 상태는 보지 않았다
    const paths_ = log.started.map(({ path }) => path)
    expect(paths_).toContain('/workspaces/ws_01/meetings')
    expect(paths_).not.toContain('/workspaces/ws_01/integrations')
  })

  it('목록은 들어올 때 새로 받는다 — 30초 캐시의 「정리 중 없음」을 믿지 않는다', async () => {
    completeMeeting('mt_10')
    const app = renderApp(paths.dashboard('ws_01'))
    await screen.findByRole('heading', { name: '대시보드' })
    // 캐시에 「정리 중 없음」을 넣어 둔 뒤, 서버에서는 다른 회의가 정리를 시작했다
    await act(() =>
      app.queryClient.prefetchQuery({
        queryKey: ['workspace', 'ws_01', 'meetings', 'list'],
        queryFn: () => [],
      }),
    )
    db.meetings[2].status = 'processing'
    act(() => app.navigate(UPLOAD_PATH))
    expect(await screen.findByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_10'))
  })

  it('Notion 미연결이면 D-097 모달 — 취소하면 회의록 목록으로', async () => {
    completeMeeting('mt_10')
    db.integrations.ws_01.notion.status = 'not_connected'
    const user = userEvent.setup()
    const app = renderApp(UPLOAD_PATH)

    const dialog = await screen.findByRole('dialog', { name: 'Notion 연결이 필요해요' })
    expect(within(dialog).getByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '정리 시작하기' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    // 취소는 회의록 목록으로 간다. U5 부터 목록은 가장 최근 회의록(정리를 마친 mt_10)으로 주소를 바꾼다 (D-106, U5-1)
    await app.expectPath(paths.meetings('ws_01', 'mt_10'))
    expect(app.visited().map(({ pathname }) => pathname)).toContain(paths.meetings('ws_01'))
  })

  it('Notion 끊김이면 D-100 모달 — 연결 버튼은 설정의 Notion 영역으로, 복귀는 업로드 경로다', async () => {
    completeMeeting('mt_10')
    db.integrations.ws_01.notion.status = 'revoked'
    const user = userEvent.setup()
    const app = renderApp(UPLOAD_PATH)

    const dialog = await screen.findByRole('dialog', { name: 'Notion 연결이 끊어졌어요' })
    await user.click(within(dialog).getByRole('button', { name: 'Notion 다시 연결하기' }))
    await app.expectPath(paths.settings('ws_01'))
    await app.expectSearch(`?section=notion&next=${encodeURIComponent(UPLOAD_PATH)}`)
    expect(await screen.findByRole('heading', { name: 'Notion 연결' })).toHaveFocus()
  })

  it('연동 상태 조회 실패는 미연결로 보지 않는다 — 모달 없이 다시 시도를 주고, 다시 시도하면 들어간다', async () => {
    completeMeeting('mt_10')
    server.use(
      http.get(
        '/api/v1/workspaces/:workspaceId/integrations',
        () => fail('FORBIDDEN', 'nope', 403),
        { once: true },
      ),
    )
    const user = userEvent.setup()
    renderApp(UPLOAD_PATH)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('회의를 올릴 수 있는지 확인하지 못했어요')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('button', { name: '정리 시작하기' })).toBeInTheDocument()
  })

  it('회의 목록 조회 실패도 다시 시도를 준다', async () => {
    completeMeeting('mt_10')
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/meetings', () => fail('FORBIDDEN', 'nope', 403), {
        once: true,
      }),
    )
    const user = userEvent.setup()
    renderApp(UPLOAD_PATH)
    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('button', { name: '정리 시작하기' })).toBeInTheDocument()
  })
})

describe('일반 팀원 (U3-11)', () => {
  it('업로드 경로 직접 진입은 PM 가드가 막고 업로드 관련 요청은 0회다', async () => {
    setMockRole('member')
    const log = recordRequests()
    const app = renderApp(UPLOAD_PATH)
    await screen.findByRole('heading', { name: '태스크' })
    await app.expectPath(paths.tasks('ws_01'))
    // U4 의 추적기는 업로드와 무관하게 모든 워크스페이스 화면에서 지금 공간의 회의 목록과 정리 중 회의 상세를 받는다.
    // 그 두 모양만 빼고 본다 — 업로드·연동·팀원 요청은 여전히 0회다. 추적기 요청은 meetingProcessing.test.tsx 가 단언한다
    const related = log.started
      .filter((request) => !isTrackerRequest(request))
      .filter(({ path }) => /\/meetings|\/integrations|\/members/.test(path))
    expect(related).toEqual([])
  })
})

describe('파일 고르기 (U3-4)', () => {
  it('여러 파일을 한 번에 넣으면 오류를 보이고 받지 않는다', async () => {
    await openUpload()
    drop([audio('a.m4a'), audio('b.m4a')])
    expect(await screen.findByText('파일은 한 번에 하나만 올릴 수 있어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '파일 제거' })).toBeNull()
    expect(readAudioDuration).not.toHaveBeenCalled()
  })

  it.each([
    [
      '허용하지 않는 형식',
      () => new BrowserFile(['x'], '회의.mp4'),
      'MP3·WAV·M4A·OGG·WebM 파일만 올릴 수 있어요.',
    ],
    [
      '빈 파일',
      () => new BrowserFile([], '회의.mp3'),
      '빈 파일이에요. 녹음이 담긴 파일을 골라 주세요.',
    ],
  ])('%s 는 길이를 읽기 전에 막는다', async (_, make, message) => {
    await openUpload()
    drop([make()])
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(readAudioDuration).not.toHaveBeenCalled()
  })

  it('길이를 읽지 못하면 형식 확인 안내와 함께 제출을 막는다', async () => {
    vi.mocked(readAudioDuration).mockResolvedValue(null)
    const log = recordRequests()
    const { user } = await openUpload()
    await choose(user, audio('깨진 녹음.webm'))
    expect(
      await screen.findByText('파일 길이를 읽지 못했어요. 녹음 파일 형식이 맞는지 확인해 주세요.'),
    ).toBeInTheDocument()
    await addAttendee(user, '김서연')
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(uploadsIn(log)).toEqual([])
    expect(screen.getByRole('button', { name: '컴퓨터에서 찾기' })).toHaveFocus()
  })

  it('2시간을 넘으면 막는다 — 정확히 2시간은 받는다', async () => {
    vi.mocked(readAudioDuration).mockResolvedValueOnce(2 * 3_600_000 + 1)
    const { user } = await openUpload()
    await choose(user, audio('긴 회의.mp3'))
    expect(await screen.findByText('2시간 이하 녹음만 올릴 수 있어요.')).toBeInTheDocument()

    vi.mocked(readAudioDuration).mockResolvedValueOnce(2 * 3_600_000)
    await choose(user, audio('딱 두 시간.mp3'))
    expect(await screen.findByText('2:00:00 · 0.1 MiB')).toBeInTheDocument()
    expect(screen.queryByText('2시간 이하 녹음만 올릴 수 있어요.')).toBeNull()
  })

  it('파일 없이 제출하면 파일 안내와 다른 칸의 안내를 함께 보이고 요청하지 않는다', async () => {
    const log = recordRequests()
    const { user } = await openUpload()
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByText('정리할 녹음 파일을 골라 주세요.')).toBeInTheDocument()
    expect(screen.getByText('회의 제목을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('참석자를 한 명 이상 골라 주세요.')).toBeInTheDocument()
    expect(uploadsIn(log)).toEqual([])
  })
})

describe('제목·날짜·참석자 (U3-5, U3-6)', () => {
  it('제목은 확장자를 포함한 파일 이름, 날짜는 lastModified 의 서울 날짜다', async () => {
    const { user } = await openUpload()
    // UTC 로는 9월 8일 15:30 — 서울로는 9일 00:30 이다
    await choose(user, audio('3주차 정기회의.m4a', Date.parse('2026-09-08T15:30:00Z')))
    await waitFor(() =>
      expect(screen.getByLabelText('회의 제목')).toHaveValue('3주차 정기회의.m4a'),
    )
    expect(screen.getByLabelText('회의 날짜')).toHaveValue('2026-09-09')
    expect(screen.getByText('52:14 · 0.1 MiB')).toBeInTheDocument()
  })

  it('파일을 바꾸면 제목·날짜는 새 파일 기준이고 고른 참석자는 남는다', async () => {
    const { user } = await openUpload()
    await fillValid(user)
    await addAttendee(user, '박민수')
    await user.clear(screen.getByLabelText('회의 제목'))
    await user.type(screen.getByLabelText('회의 제목'), '고친 제목')

    await choose(user, audio('4주차.mp3', Date.parse('2026-09-16T01:00:00Z')))
    await waitFor(() => expect(screen.getByLabelText('회의 제목')).toHaveValue('4주차.mp3'))
    expect(screen.getByLabelText('회의 날짜')).toHaveValue('2026-09-16')
    const chosen = screen.getByRole('list', { name: '고른 참석자' })
    expect(within(chosen).getByText('김서연')).toBeInTheDocument()
    expect(within(chosen).getByText('박민수')).toBeInTheDocument()
  })

  it('참석자 후보는 이 공간에 등록된 팀원뿐이다', async () => {
    const { user } = await openUpload()
    await user.click(await screen.findByRole('button', { name: '추가' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent?.slice(1))).toEqual([
      '김서연',
      '박민수',
      '이재환',
      '정하늘',
    ])
  })

  it('공백뿐인 제목은 막는다 — 요청하지 않는다', async () => {
    const log = recordRequests()
    const { user } = await openUpload()
    await fillValid(user)
    await user.clear(screen.getByLabelText('회의 제목'))
    await user.type(screen.getByLabelText('회의 제목'), '   ')
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByText('회의 제목을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByLabelText('회의 제목')).toHaveFocus()
    expect(uploadsIn(log)).toEqual([])
  })

  it('참석자 0명은 막는다 — 요청하지 않는다', async () => {
    const log = recordRequests()
    const { user } = await openUpload()
    await choose(user, audio())
    await waitFor(() =>
      expect(screen.getByLabelText('회의 제목')).toHaveValue('3주차 정기회의.m4a'),
    )
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByText('참석자를 한 명 이상 골라 주세요.')).toBeInTheDocument()
    expect(uploadsIn(log)).toEqual([])
  })

  it('날짜를 고치지 않으면 원래 시각, 고치면 고른 날 서울 자정을 보낸다', async () => {
    const forms = recordUploads()
    const { user } = await openUpload()
    await fillValid(user, audio('그대로.m4a', Date.parse('2026-09-08T15:30:00Z')))
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    await screen.findByRole('heading', { name: PROCESSING_HEADING })
    expect(forms[0].started_at).toEqual(['2026-09-08T15:30:00.000Z'])
  })

  it('날짜를 고치면 그 날 서울 자정의 ISO 시각을 보낸다', async () => {
    const forms = recordUploads()
    const { user } = await openUpload()
    await fillValid(user)
    fireEvent.change(screen.getByLabelText('회의 날짜'), { target: { value: '2026-09-11' } })
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    await screen.findByRole('heading', { name: PROCESSING_HEADING })
    expect(forms[0].started_at).toEqual(['2026-09-10T15:00:00.000Z'])
  })
})

describe('제출 (U3-7, U3-8, U3-9)', () => {
  it('202 를 받으면 처리 화면으로 옮기고 회의를 추적 대상에 등록한다 — 필드 이름은 계약 그대로다', async () => {
    const forms = recordUploads()
    const { user, app } = await openUpload({ strict: true })
    await fillValid(user)
    await addAttendee(user, '이재환')
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))

    expect(await screen.findByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_11'))
    expect(forms).toEqual([
      {
        title: ['3주차 정기회의.m4a'],
        started_at: [new Date(NINE_AM_SEOUL).toISOString()],
        attendee_member_ids: ['mb_01', 'mb_03'],
        file: ['(file)'],
      },
    ])
    expect(useMeetingTrackerStore.getState().meetings).toEqual([
      { workspaceId: 'ws_01', meetingId: 'mt_11' },
    ])
    // 입력을 놓고 묻지 않고 갔다 — 이탈 확인이 열리지 않았다
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('202 뒤에는 원본 파일 참조가 Mutation·Query 캐시 어디에도 남지 않는다', async () => {
    const { user, app } = await openUpload({ strict: true })
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    await screen.findByRole('heading', { name: PROCESSING_HEADING })

    const mutations = app.queryClient.getMutationCache().getAll()
    // 업로드 mutation 은 성공으로 캐시에 남아 있다 — 그 변수·결과에 파일이 없다
    expect(mutations.map(({ state }) => state.status)).toEqual(['success'])
    expect(mutations[0].state.variables).toEqual({
      title: '3주차 정기회의.m4a',
      startedAt: new Date(NINE_AM_SEOUL).toISOString(),
      attendeeMemberIds: ['mb_01'],
    })
    expect(mutations.filter(({ state }) => holdsBytes(state))).toEqual([])
    expect(
      app.queryClient
        .getQueryCache()
        .getAll()
        .filter(({ state }) => holdsBytes(state)),
    ).toEqual([])
  })

  it('전송률 100% 만으로는 끝나지 않는다 — 202 가 올 때까지 업로드 화면에서 진행을 보인다', async () => {
    const gate = deferred()
    server.use(
      http.post(UPLOAD, async () => {
        await gate.promise
        return undefined
      }),
    )
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/파일을 보내는 중이에요|파일을 다 보냈어요/)
    expect(screen.getByRole('button', { name: '정리 시작하기' })).toBeDisabled()
    expect(screen.getByLabelText('회의 제목')).toBeDisabled()
    await app.expectPath(UPLOAD_PATH)

    gate.resolve()
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_11'))
  })

  it('연타해도 업로드 POST 는 정확히 1회다', async () => {
    const gate = deferred()
    server.use(
      http.post(UPLOAD, async () => {
        await gate.promise
        return undefined
      }),
    )
    const log = recordRequests()
    const { user, app } = await openUpload()
    await fillValid(user)
    const submit = screen.getByRole('button', { name: '정리 시작하기' })
    await user.click(submit)
    await user.click(submit)
    fireEvent.submit(submit.closest('form')!)
    gate.resolve()
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_11'))
    expect(uploadsIn(log)).toHaveLength(1)
  })

  it('응답을 잃었는데 서버가 받았으면 목록을 다시 보고 그 처리 화면으로 간다 — 다시 보내지 않는다', async () => {
    server.use(
      http.post(UPLOAD, () => {
        // 서버는 받아 정리를 시작했지만 응답이 오지 않았다
        db.meetings[2].status = 'processing'
        return HttpResponse.error()
      }),
    )
    const log = recordRequests()
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))

    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_10'))
    expect(uploadsIn(log)).toHaveLength(1)
    const afterUpload = log.timeline.slice(
      log.timeline.indexOf(`start POST ${UPLOAD.replace('/api/v1', '')}`),
    )
    expect(afterUpload).toContain('start GET /workspaces/ws_01/meetings')
  })

  it('응답을 잃었고 목록에도 정리 중 회의가 없으면 다시 올리라고 안내한다 — 자동 재전송 없음', async () => {
    server.use(http.post(UPLOAD, () => HttpResponse.error()))
    const log = recordRequests()
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))

    expect(
      await screen.findByText(
        '올린 결과를 확인하지 못했어요. 네트워크 연결을 확인한 뒤 다시 올려 주세요.',
      ),
    ).toBeInTheDocument()
    await app.expectPath(UPLOAD_PATH)
    expect(uploadsIn(log)).toHaveLength(1)
    // 고른 파일과 입력은 남아 있다 — 사용자가 직접 다시 보낸다
    expect(screen.getByText('3주차 정기회의.m4a')).toBeInTheDocument()
  })

  it('파일을 고른 뒤 떠나려 하면 이탈 확인을 묻는다', async () => {
    const { user, app } = await openUpload()
    await choose(user, audio())
    await screen.findByRole('button', { name: '파일 제거' })
    await user.click(screen.getByRole('link', { name: '대시보드' }))
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))
    await app.expectPath(UPLOAD_PATH)
    expect(screen.getByText('3주차 정기회의.m4a')).toBeInTheDocument()
  })

  it('보내는 동안 떠나려다 이탈 확인을 고르는 중에 202 가 오면 처리 화면이 아니라 고른 곳으로 간다', async () => {
    const gate = deferred()
    server.use(
      http.post(UPLOAD, async () => {
        await gate.promise
        return undefined
      }),
    )
    const { user, app } = await openUpload({ strict: true })
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    await user.click(screen.getByRole('link', { name: '대시보드' }))
    await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })

    gate.resolve()
    await app.expectPath(paths.dashboard('ws_01'))
    // 버릴 입력이 없어졌으니 더 묻지 않는다. 받아진 회의는 추적 대상이다
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(
      paths.meetingProcessing('ws_01', 'mt_11'),
    )
    expect(useMeetingTrackerStore.getState().meetings).toEqual([
      { workspaceId: 'ws_01', meetingId: 'mt_11' },
    ])
  })

  it('파일을 고르기 전에는 묻지 않고 떠난다', async () => {
    const { user, app } = await openUpload()
    await user.click(screen.getByRole('link', { name: '대시보드' }))
    await app.expectPath(paths.dashboard('ws_01'))
  })
})

describe('업로드 오류 (U3-10)', () => {
  it('409 정리 중 + details.meeting_id 는 그 처리 화면으로 간다', async () => {
    server.use(
      http.post(UPLOAD, () =>
        fail('MEETING_PROCESSING_IN_PROGRESS', '처리 중', 409, { meeting_id: 'mt_10' }),
      ),
    )
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_10'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('413 은 파일 칸에 알리고 화면에 머문다', async () => {
    server.use(http.post(UPLOAD, () => fail('AUDIO_TOO_LARGE', '너무 큼', 413)))
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByText('200 MiB 이하 파일만 올릴 수 있어요.')).toBeInTheDocument()
    await app.expectPath(UPLOAD_PATH)
  })

  it('400 검증 오류는 폼 위에 알린다', async () => {
    server.use(http.post(UPLOAD, () => fail('INVALID_REQUEST', 'bad', 400)))
    const { user } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('요청 내용을 다시 확인해 주세요.')
  })

  it.each([
    ['not_connected', 'Notion 연결이 필요해요'],
    ['revoked', 'Notion 연결이 끊어졌어요'],
  ] as const)('연동 오류(%s)는 차단 모달로 바뀐다', async (status, title) => {
    const { user, app } = await openUpload()
    await fillValid(user)
    // 들어온 뒤에 연결이 끊겼다 — 서버의 409 가 알린다
    db.integrations.ws_01.notion.status = status
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    const dialog = await screen.findByRole('dialog', { name: title })
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await app.expectPath(UPLOAD_PATH)
  })

  it('401 은 기존 세션 만료 처리로 로그인에 간다', async () => {
    server.use(http.post(UPLOAD, () => fail('UNAUTHENTICATED', '로그인 필요', 401)))
    const { user, app } = await openUpload()
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    // 세션이 끝나 이탈 확인을 풀었다 — 모달이 남지 않는다
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('업로드 handler 는 원본 파일을 어디에도 남기지 않는다 (G5)', async () => {
  const { user } = await openUpload()
  await fillValid(user)
  await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
  await screen.findByRole('heading', { name: PROCESSING_HEADING })
  expect(JSON.stringify(db)).not.toContain('audio-bytes')
  expect(JSON.stringify(useMeetingTrackerStore.getState())).not.toContain('m4a')
})

it('업로드 응답 handler 는 202 와 처리 중 회의를 준다 — 화면이 이 응답만 보고 옮긴다', async () => {
  server.use(
    http.post(UPLOAD, () => ok({ meeting_id: 'mt_77', status: 'processing' }, { status: 202 })),
  )
  const { user, app } = await openUpload()
  await fillValid(user)
  await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
  await app.expectPath(paths.meetingProcessing('ws_01', 'mt_77'))
})
