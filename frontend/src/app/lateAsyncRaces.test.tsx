import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { File as NodeFile } from 'node:buffer'
import type { ComponentType } from 'react'
import { HttpResponse, getResponse, http } from 'msw'
import { integrationsQueryOptions } from '@/entities/integration'
import {
  clearTrackedMeetings,
  meetingListQueryOptions,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { readAudioDuration } from '@/features/meeting-upload'
import { PROCESSING_DONE_TITLE, PROCESSING_FAILED_TITLE } from '@/features/meeting-processing'
import { paths } from '@/shared/config/routes'
import { withOAuthResult } from '@/shared/lib/oauth'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { handlers } from '@/shared/mock/handlers'
import { completeMeeting, failMeeting } from '@/shared/mock/meetingFlow'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { signalsWith } from './test/processingToast'
import { renderApp } from './test/renderApp'

/*
 * U4 r1 M01·M02 와 같은 종류의 경합 — 늦게 끝난 비동기 작업이 지금 화면·세션을 확인하지 않고 부작용을 내는가.
 *
 * M01: 사용자가 누른 이동이 지연 로드 화면을 기다리는 동안에는 기록(history)은 새 경로인데 그려진 경로(useLocation)는
 * 이전 화면이다. 그 틈에 끝난 처리가 이전 화면 기준으로 사용자를 옮기면 사용자의 이동을 덮어쓴다.
 * 테스트는 경로 표의 지연 로드(lazyPage)만 바꿔 끼워 「처음 그리는 화면」의 코드 도착을 붙잡는다. 실제 Chromium 재현의
 * `/src/pages/tasks/index.ts` 지연과 같은 창이다. 지연 로드는 화면마다 한 번만 일어나므로(React.lazy 가 결과를 기억한다)
 * 테스트마다 이 파일에서 아직 그리지 않은 화면으로 간다. 붙잡혔는지는 각 테스트가 「이전 화면이 아직 그려져 있다」로 확인한다.
 *
 * M02: 세션이 끝나는 순간(로그아웃·401 만료) 진행 중이던 조회가 취소·실패로 떨어져도 그 뒷처리가 알림·모달·이동을 내지 않는다.
 */
const lazyGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('./router/lazyPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router/lazyPage')>()
  return {
    lazyPage: (load: () => Promise<ComponentType>) =>
      actual.lazyPage(async () => {
        // 화면 코드를 처음 부르는 순간의 붙잡기를 따른다
        const hold = lazyGate.hold
        const page = await load()
        if (hold) await hold
        return page
      }),
  }
})
// 업로드 화면의 길이 읽기만 바꿔 끼운다 — jsdom 은 미디어 메타데이터를 읽지 못한다 (meetingUpload.test.tsx 와 같다)
vi.mock('@/features/meeting-upload/model/audioDuration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/meeting-upload/model/audioDuration')>()),
  readAudioDuration: vi.fn(),
}))

// 이 파일의 검사는 앱 전체를 그리고 polling·로그아웃·재로그인을 실제로 거친다. 전체 실행 부하에서 파일의 첫 검사가
// 지연 로드 변환까지 떠안아 기본 5초를 넘긴 적이 있다 — 다른 앱 수준 검사(meetingProcessing·authFlow)와 같은 10초를 준다
vi.setConfig({ testTimeout: 10_000 })

const PROCESSING_PATH = paths.meetingProcessing('ws_01', 'mt_10')
const PROCESSING_HEADING = '정리하고 있어요'
const INTEGRATIONS = '/api/v1/workspaces/:workspaceId/integrations'
const BrowserFile = globalThis.File

afterEach(() => {
  lazyGate.hold = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearTrackedMeetings()
})

/** 이제부터 처음 그리는 화면의 코드 도착을 붙잡는다. 풀 때까지 그 이동은 transition 으로 기다린다 */
function holdFirstPaints() {
  const gate = deferred()
  lazyGate.hold = gate.promise
  return {
    release: () => {
      lazyGate.hold = null
      gate.resolve()
    },
  }
}

/**
 * 다음 연동 조회 하나를 붙잡는다. 풀면 `answer` 가 응답한다(없으면 원래 handler).
 * `every` 면 풀 때까지 오는 연동 조회를 모두 붙잡는다 — 취소된 조회를 판정이 다시 묻는 경우(StrictMode 재마운트)다
 */
function holdIntegrations(answer?: () => Response, { every = false } = {}) {
  const gate = deferred()
  server.use(
    http.get(
      INTEGRATIONS,
      async () => {
        await gate.promise
        return answer?.()
      },
      { once: !every },
    ),
  )
  return gate
}

/**
 * `path` 로 가는 다음 GET 하나를 붙잡는다. 답은 **요청을 받은 그 순간의 서버 상태**다(원래 handler 로 그때 만든다) —
 * 풀기 전에 서버가 바뀌어도 이전 상태를 돌려준다. 먼저 출발한 공유 조회의 늦은 답이다 (U4 r3 M05 Chromium 재현과 같다)
 */
function holdSnapshot(path: string) {
  const gate = deferred()
  server.use(
    http.get(
      path,
      async ({ request }) => {
        const snapshot = await getResponse(handlers, request.clone())
        await gate.promise
        return snapshot
      },
      { once: true },
    ),
  )
  return gate
}

const UNAUTHENTICATED = () => fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)

/** 추적기가 적은 정리 결과. 진행 토스트는 이 기록으로 완료·실패를 그린다 — 회의마다 한 번 적는다 */
const settledAs = (outcome: 'done' | 'failed') =>
  useMeetingTrackerStore.getState().settled.filter((record) => record.outcome === outcome)
const pathsOf = (app: ReturnType<typeof renderApp>) => app.visited().map(({ pathname }) => pathname)

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

/** 실제 시간으로 기다린다. 가짜 setInterval 이 저절로 돌지 않게 vi.waitFor 를 쓰지 않는다 (meetingProcessing.test.tsx) */
async function until<T>(check: () => T, timeout = 3000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      return check()
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
    await act(() => settle(20))
  }
}

/** setInterval 만 가짜다 — 3초 polling 을 테스트가 돌린다 */
function fakeIntervals() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
}

async function nextPoll() {
  await act(() => vi.advanceTimersByTimeAsync(3_000))
}

async function openProcessing() {
  const app = renderApp(PROCESSING_PATH, { strict: true })
  await screen.findByRole('heading', { name: PROCESSING_HEADING })
  return app
}

function headerLink(name: string) {
  return within(screen.getByRole('navigation', { name: '주요 화면' })).getByRole('link', { name })
}

async function logOut(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^내 계정/ }))
  await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
  await screen.findByRole('heading', { name: '로그인' })
}

/** 로그인 화면에서 같은 PM 으로 다시 로그인한다. 새 세션이 시작되고 워크스페이스 선택으로 간다 */
async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('이메일'), 'pm@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await user.click(screen.getByRole('button', { name: '로그인' }))
  await screen.findByRole('heading', { name: '워크스페이스 선택' })
}

/** 새 세션이 그대로 이어지는가 — 세션 캐시에 사용자가 있고 로그인 화면으로 돌아가지 않았다 */
function expectSessionKept(app: ReturnType<typeof renderApp>) {
  expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeTruthy()
  expect(screen.getByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '로그인' })).toBeNull()
  expect(pathsOf(app).at(-1)).toBe('/workspaces')
}

describe('진행 중인 사용자 이동을 정리 결과가 덮어쓰지 않는다 (U4 r1 M01)', () => {
  it('완료: 태스크로 가는 중(화면 코드 대기)에 끝나도 회의록으로 끌고 가지 않는다 — 진행 토스트만 바뀌고 결과는 한 번', async () => {
    fakeIntervals()
    const user = userEvent.setup()
    const app = await openProcessing()

    const paint = holdFirstPaints()
    await user.click(headerLink('태스크'))
    // 이동은 시작됐고 태스크 화면 코드를 기다린다 — 처리 화면이 아직 그려져 있다
    expect(screen.getByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '태스크' })).toBeNull()

    completeMeeting('mt_10')
    await nextPoll()
    await until(() => expect(settledAs('done')).toHaveLength(1))
    await act(() => settle())

    paint.release()
    expect(await screen.findByRole('heading', { name: '태스크' })).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(paths.tasks('ws_01'))
    expect(pathsOf(app)).not.toContain(paths.meetings('ws_01', 'mt_10'))
    // 처리 화면을 떠나서야 진행 토스트가 완료로 보인다
    expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1)
    expect(settledAs('done')).toHaveLength(1)
  })

  it('실패: 메시지로 가는 중(화면 코드 대기)에 끝나도 회의록 목록으로 끌고 가지 않는다 — 진행 토스트만 바뀌고 결과는 한 번', async () => {
    fakeIntervals()
    const user = userEvent.setup()
    const app = await openProcessing()

    const paint = holdFirstPaints()
    await user.click(headerLink('메시지'))
    // 이동은 시작됐고 메시지 화면 코드를 기다린다 — 처리 화면이 아직 그려져 있다
    expect(screen.getByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()

    failMeeting('mt_10')
    await nextPoll()
    await until(() => expect(settledAs('failed')).toHaveLength(1))
    await act(() => settle())

    paint.release()
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(paths.messages('ws_01'))
    expect(pathsOf(app)).not.toContain(paths.meetings('ws_01'))
    expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1)
    expect(settledAs('failed')).toHaveLength(1)
  })
})

describe('U3 의 같은 종류 경합', () => {
  const UPLOAD_PATH = paths.meetingUpload('ws_01')
  const UPLOAD = '/api/v1/workspaces/ws_01/meetings/upload'

  /**
   * 설정의 Notion 복귀 확인을 붙잡은 채 연다 (notionConnection.test.tsx 와 같은 모양).
   * 붙잡힌 조회는 풀리면 연결됨을 돌려준다 — 서버는 세션이 끝나기 전에 그 요청을 받아 답을 만들었다
   */
  async function openVerifying() {
    completeMeeting('mt_10')
    settleMockOAuth({ workspaceId: 'ws_01', provider: 'notion', outcome: 'success' })
    // StrictMode 재마운트가 첫 조회를 거두면 확인이 다시 묻는다(fetchFresh) — 그 조회까지 붙잡는다
    const answer = holdIntegrations(() => ok(db.integrations.ws_01), { every: true })
    const user = userEvent.setup()
    const app = renderApp(withOAuthResult(paths.settingsNotion('ws_01'), 'notion', 'success'), {
      strict: true,
    })
    const area = within(await screen.findByTestId('notion-connection'))
    expect(await area.findByText('연결을 확인하고 있어요.')).toBeInTheDocument()
    return { answer, user, app }
  }

  it('Notion 복귀 확인 중 로그아웃하면 이전 사용자의 연동 상태를 캐시에 다시 쓰지 않는다', async () => {
    const { answer, user, app } = await openVerifying()
    await logOut(user)

    answer.resolve()
    await act(() => settle(200))
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)).toBeUndefined()
  })

  /**
   * 파일·참석자를 채운 업로드 화면. 업로드 응답은 붙잡아 둔다.
   * `accepted` 면 풀렸을 때 서버가 이미 받아 둔 202 를 그대로 돌려준다 — 그 사이 세션이 끝났어도 받은 것은 받은 것이다.
   * `reply` 를 주면 풀렸을 때 그 답을 돌려준다
   */
  async function openSending({
    accepted = false,
    reply,
  }: { accepted?: boolean; reply?: () => Response } = {}) {
    vi.stubGlobal('File', NodeFile)
    vi.mocked(readAudioDuration)
      .mockReset()
      .mockResolvedValue(52 * 60_000)
    completeMeeting('mt_10')
    const answer = deferred()
    server.use(
      http.post(UPLOAD, async () => {
        await answer.promise
        if (reply) return reply()
        return accepted
          ? ok({ meeting_id: 'mt_11', status: 'processing' }, { status: 202 })
          : undefined
      }),
    )
    const user = userEvent.setup({ applyAccept: false })
    const app = renderApp(UPLOAD_PATH, { strict: true })
    await screen.findByRole('button', { name: '정리 시작하기' })
    const file = new BrowserFile(['audio-bytes'], '3주차 정기회의.m4a', { type: 'audio/mp4' })
    await user.upload(screen.getByLabelText('녹음 파일'), file)
    await waitFor(() => expect(screen.getByLabelText('회의 제목')).toHaveValue(file.name))
    await user.click(await screen.findByRole('button', { name: '추가' }))
    await user.click(await screen.findByRole('menuitem', { name: /김서연/ }))
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    return { answer, user, app }
  }

  /*
   * 업로드 화면은 PM 가드 칸 안에 있다. 가드가 없는 화면(대시보드 등)으로 가면 화면 칸이 새로 생겨 바로 Skeleton 이 그려지고
   * 폼이 내려간다 — 기다리는 틈이 없다. 같은 PM 가드 칸의 화면(확인 필요 상세)으로 가면 이전 화면이 그대로 남아 틈이 생긴다
   */
  it('보내는 중 이탈 확인에서 나가기를 고른 이동이 화면 코드를 기다리는 사이 202 가 와도 처리 화면으로 끌고 가지 않는다', async () => {
    const { answer, user, app } = await openSending()
    const target = paths.approval('ws_01', 'ap_01')
    act(() => app.navigate(target))
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    const paint = holdFirstPaints()
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(screen.getByRole('heading', { name: '회의를 올려 주세요' })).toBeInTheDocument()

    answer.resolve()
    await waitFor(() =>
      expect(useMeetingTrackerStore.getState().meetings).toEqual([
        { workspaceId: 'ws_01', meetingId: 'mt_11' },
      ]),
    )
    await act(() => settle())

    paint.release()
    expect(
      await screen.findByRole('heading', { level: 1, name: '이 태스크, 승인할까요?' }),
    ).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(target)
    expect(pathsOf(app)).not.toContain(paths.meetingProcessing('ws_01', 'mt_11'))
  })

  /*
   * U4 r2 M03 과 같은 함정. 응답을 잃은 뒤의 목록 재조회가 공유 캐시 조회면, 다른 공간으로 가 그 목록의 구독(업로드 화면·
   * 공간의 발견)이 모두 내려갈 때 취소된 채 들어올 때 받은 목록(정리 중 없음)을 새 답처럼 돌려준다
   */
  it('응답을 잃고 목록을 다시 보는 사이 다른 공간으로 가도 서버가 받은 회의를 추적에 넣는다', async () => {
    vi.stubGlobal('File', NodeFile)
    vi.mocked(readAudioDuration)
      .mockReset()
      .mockResolvedValue(52 * 60_000)
    completeMeeting('mt_10')
    const list = deferred()
    server.use(
      http.post(UPLOAD, () => {
        // 서버는 받아 정리를 시작했지만 응답이 오지 않았다. 복구의 목록 조회는 붙잡는다
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
        meeting.status = 'processing'
        server.use(
          http.get(
            '/api/v1/workspaces/ws_01/meetings',
            async () => {
              await list.promise
              return undefined
            },
            { once: true },
          ),
        )
        return HttpResponse.error()
      }),
    )
    const log = recordRequests()
    const user = userEvent.setup({ applyAccept: false })
    const app = renderApp(UPLOAD_PATH, { strict: true })
    await screen.findByRole('button', { name: '정리 시작하기' })
    const file = new BrowserFile(['audio-bytes'], '3주차 정기회의.m4a', { type: 'audio/mp4' })
    await user.upload(screen.getByLabelText('녹음 파일'), file)
    await waitFor(() => expect(screen.getByLabelText('회의 제목')).toHaveValue(file.name))
    await user.click(await screen.findByRole('button', { name: '추가' }))
    await user.click(await screen.findByRole('menuitem', { name: /김서연/ }))
    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    const listsAfterUpload = () => {
      const timeline = log.timeline.slice(
        log.timeline.indexOf(`start POST ${UPLOAD.replace('/api/v1', '')}`),
      )
      return timeline.filter((entry) => entry === 'start GET /workspaces/ws_01/meetings')
    }
    await waitFor(() => expect(listsAfterUpload()).toHaveLength(1))

    act(() => app.navigate(paths.dashboard('ws_02')))
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    // 픽스처의 ws_02 는 온보딩 중이라 그 단계로 간다. 어느 쪽이든 ws_01 의 화면(업로드·공간의 발견)이 모두 내려간다
    const left = paths.onboardingStep('ws_02', 'connect_notion')
    await app.expectPath(left)
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '회의를 올려 주세요' })).toBeNull(),
    )

    list.resolve()
    await waitFor(() =>
      expect(useMeetingTrackerStore.getState().meetings).toEqual([
        { workspaceId: 'ws_01', meetingId: 'mt_10' },
      ]),
    )
    // 떠난 사용자를 처리 화면으로 데려오지 않는다
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(left)
    expect(pathsOf(app)).not.toContain(paths.meetingProcessing('ws_01', 'mt_10'))
  })

  it('보내는 중 로그아웃하면 늦게 온 202 가 이전 사용자의 회의를 추적에 넣지 않는다', async () => {
    const { answer, user, app } = await openSending({ accepted: true })
    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    // 고른 파일이 있어 먼저 묻는다
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await screen.findByRole('heading', { name: '로그인' })

    answer.resolve()
    await act(() => settle(300))
    await app.expectPath('/login')
    expect(useMeetingTrackerStore.getState().meetings).toEqual([])
    expect(pathsOf(app)).not.toContain(paths.meetingProcessing('ws_01', 'mt_11'))
  })

  /*
   * U4 r3 M04 의 401 알림 거르기만 따로 본다. 업로드 POST 는 mutation 이라 세션 정리의 취소가 닿지 않는다 —
   * 이전 세션에서 보낸 요청의 401 이 실제로 도착한다. 공통 요청이 출발 세대로 거르지 않으면 새 세션이 끝난다
   */
  it('보내는 중 로그아웃·재로그인하면 그 업로드의 늦은 401 이 새 세션을 끝내지 않는다 (U4 r3 M04)', async () => {
    const { answer, user, app } = await openSending({ reply: UNAUTHENTICATED })
    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    const dialog = await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' })
    await user.click(within(dialog).getByRole('button', { name: '변경 내용 버리고 나가기' }))
    await screen.findByRole('heading', { name: '로그인' })
    await logIn(user)

    const log = recordRequests()
    answer.resolve()
    await act(() => settle(300))
    expectSessionKept(app)
    // 늦은 401 은 도착했다 — 막은 것은 알림이다
    expect(log.answered).toContainEqual({
      method: 'POST',
      path: '/workspaces/ws_01/meetings/upload',
    })
    expect(useMeetingTrackerStore.getState().meetings).toEqual([])
  })

  /*
   * U4 r3 M05 와 같은 경합. 응답을 잃은 뒤의 복구 목록 조회가 받은 「정리 중 mt_10」을, 그보다 먼저 출발한
   * 공유 목록 조회의 늦은 답(정리 중 없음)이 되돌리지 못한다
   */
  it('응답을 잃은 뒤 복구 목록이 쓴 정리 중 회의를 먼저 출발한 공유 목록 조회의 늦은 답이 지우지 못한다 (U4 r3 M05)', async () => {
    vi.stubGlobal('File', NodeFile)
    vi.mocked(readAudioDuration)
      .mockReset()
      .mockResolvedValue(52 * 60_000)
    completeMeeting('mt_10')
    server.use(
      http.post(UPLOAD, () => {
        // 서버는 받아 정리를 시작했지만 응답이 오지 않았다
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
        meeting.status = 'processing'
        return HttpResponse.error()
      }),
    )
    const log = recordRequests()
    const user = userEvent.setup({ applyAccept: false })
    const app = renderApp(UPLOAD_PATH, { strict: true })
    await screen.findByRole('button', { name: '정리 시작하기' })
    const file = new BrowserFile(['audio-bytes'], '3주차 정기회의.m4a', { type: 'audio/mp4' })
    await user.upload(screen.getByLabelText('녹음 파일'), file)
    await waitFor(() => expect(screen.getByLabelText('회의 제목')).toHaveValue(file.name))
    await user.click(await screen.findByRole('button', { name: '추가' }))
    await user.click(await screen.findByRole('menuitem', { name: /김서연/ }))

    // 보내기 전에 공유 목록 조회가 출발한다. 서버는 그때의 목록(정리 중 없음)을 답했지만 그 답이 늦게 온다
    const listKey = meetingListQueryOptions('ws_01').queryKey
    const lists = () =>
      log.started.filter(
        ({ method, path }) => method === 'GET' && path === '/workspaces/ws_01/meetings',
      )
    const before = lists().length
    const shared = holdSnapshot('/api/v1/workspaces/ws_01/meetings')
    act(() => {
      void app.queryClient.invalidateQueries({ queryKey: listKey })
    })
    await waitFor(() => expect(lists()).toHaveLength(before + 1))

    await user.click(screen.getByRole('button', { name: '정리 시작하기' }))
    // 복구의 직접 목록 조회가 정리 중 mt_10 을 찾아 처리 화면으로 간다
    await app.expectPath(paths.meetingProcessing('ws_01', 'mt_10'))
    const processingIn = () =>
      app.queryClient.getQueryData(listKey)?.find(({ id }) => id === 'mt_10')?.status
    expect(processingIn()).toBe('processing')

    shared.resolve()
    await act(() => settle(200))
    expect(processingIn()).toBe('processing')
    expect(useMeetingTrackerStore.getState().meetings).toEqual([
      { workspaceId: 'ws_01', meetingId: 'mt_10' },
    ])
  })
})
