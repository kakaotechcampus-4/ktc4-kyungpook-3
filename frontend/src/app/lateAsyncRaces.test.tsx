import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { File as NodeFile } from 'node:buffer'
import type { ComponentType } from 'react'
import { onTestFinished } from 'vitest'
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
import { toast } from '@/shared/ui/toast'
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

const toastsWith = (title: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).filter((node) =>
    node.textContent?.includes(title),
  )
const shownWith = (show: { mock: { calls: [{ title: string }][] } }, title: string) =>
  show.mock.calls.filter(([input]) => input.title === title)
const pathsOf = (app: ReturnType<typeof renderApp>) => app.visited().map(({ pathname }) => pathname)
const integrationRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(
    ({ method, path }) => method === 'GET' && path === '/workspaces/ws_01/integrations',
  )

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
  it('완료: 태스크로 가는 중(화면 코드 대기)에 끝나도 회의록으로 끌고 가지 않는다 — 토스트만 한 번', async () => {
    fakeIntervals()
    const show = vi.spyOn(toast, 'show')
    const user = userEvent.setup()
    const app = await openProcessing()

    const paint = holdFirstPaints()
    await user.click(headerLink('태스크'))
    // 이동은 시작됐고 태스크 화면 코드를 기다린다 — 처리 화면이 아직 그려져 있다
    expect(screen.getByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '태스크' })).toBeNull()

    completeMeeting('mt_10')
    await nextPoll()
    await until(() => expect(toastsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
    await act(() => settle())

    paint.release()
    expect(await screen.findByRole('heading', { name: '태스크' })).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(paths.tasks('ws_01'))
    expect(pathsOf(app)).not.toContain(paths.meetings('ws_01', 'mt_10'))
    expect(shownWith(show, PROCESSING_DONE_TITLE)).toHaveLength(1)
  })

  it('실패: 연동 재조회를 기다리는 사이 메시지로 가는 중이면 회의록 목록으로 끌고 가지 않는다 — 토스트만 한 번', async () => {
    fakeIntervals()
    const show = vi.spyOn(toast, 'show')
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openProcessing()

    const answer = holdIntegrations()
    failMeeting('mt_10')
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(1))

    const paint = holdFirstPaints()
    await user.click(headerLink('메시지'))
    expect(screen.getByRole('heading', { name: '회의를 정리하지 못했어요' })).toBeInTheDocument()

    answer.resolve()
    await until(() => expect(toastsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    await act(() => settle())

    paint.release()
    expect(
      await screen.findByRole('heading', { name: '메시지는 준비 중이에요' }),
    ).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(paths.messages('ws_01'))
    expect(pathsOf(app)).not.toContain(paths.meetings('ws_01'))
    expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(1)
  })
})

describe('세션이 끝난 뒤에는 이전 회의의 실패를 알리지 않는다 (U4 r1 M02)', () => {
  it.each([
    ['일반 실패', false],
    ['Notion 끊김 실패', true],
  ])(
    '%s — 연동 재조회 중 로그아웃하면 로그인 화면에 토스트·모달이 생기지 않는다',
    async (_label, notionRevoked) => {
      fakeIntervals()
      const show = vi.spyOn(toast, 'show')
      const log = recordRequests()
      const user = userEvent.setup()
      const app = await openProcessing()

      const answer = holdIntegrations()
      failMeeting('mt_10', { notionRevoked })
      await nextPoll()
      await until(() => expect(integrationRequests(log)).toHaveLength(1))

      await logOut(user)
      // 붙잡힌 원래 응답이 뒤늦게 와도 마찬가지다
      answer.resolve()
      await act(() => settle(200))

      await app.expectPath('/login')
      expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
      expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(pathsOf(app)).not.toContain(paths.meetings('ws_01'))
    },
  )

  it.each([
    ['일반 실패', false],
    ['Notion 끊김 실패', true],
  ])(
    '%s — 연동 재조회가 401(세션 만료)이면 로그인 화면에 토스트·모달이 생기지 않는다',
    async (_label, notionRevoked) => {
      fakeIntervals()
      const show = vi.spyOn(toast, 'show')
      const log = recordRequests()
      const app = await openProcessing()

      const answer = holdIntegrations()
      failMeeting('mt_10', { notionRevoked })
      await nextPoll()
      await until(() => expect(integrationRequests(log)).toHaveLength(1))

      // 기다리는 사이 서버 세션이 만료됐다. 붙잡힌 조회부터 그 뒤의 모든 요청이 401 이다
      db.authenticated = false
      answer.resolve()
      await screen.findByRole('heading', { name: '로그인' })
      await act(() => settle(200))

      await app.expectPath('/login')
      expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
      expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(pathsOf(app)).not.toContain(paths.meetings('ws_01'))
    },
  )

  it('연동 재조회 중 로그아웃하면 늦게 온 성공 답도 이전 사용자의 연동 상태를 캐시에 쓰지 않는다', async () => {
    fakeIntervals()
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openProcessing()

    // 서버는 세션이 끝나기 전에 요청을 받아 끊김 답을 만들었다. 판정 조회는 공유 Query 라 로그아웃의 cancelQueries 가 거두고,
    // 판정은 끝난 세션에서 다시 묻지 않는다(fetchFresh). 답이 오든 말든 이전 사용자의 연동 상태는 캐시에 남지 않는다
    const answer = holdIntegrations(() => ok(db.integrations.ws_01))
    failMeeting('mt_10', { notionRevoked: true })
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(1))

    await logOut(user)
    answer.resolve()
    await act(() => settle(200))

    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)).toBeUndefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('같은 세션 안에서 공유 연동 조회가 취소돼도 끊김 판정은 다시 물어 끊김을 알린다', async () => {
    fakeIntervals()
    const show = vi.spyOn(toast, 'show')
    const log = recordRequests()
    const app = await openProcessing()

    const answer = holdIntegrations()
    failMeeting('mt_10', { notionRevoked: true })
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(1))

    // 다른 구독이 같은 조회를 거둬 간 것과 같다. 세션은 그대로다
    await act(() =>
      app.queryClient.cancelQueries({ queryKey: integrationsQueryOptions('ws_01').queryKey }),
    )
    answer.resolve()
    expect(
      await screen.findByRole('dialog', { name: 'Notion 연결이 끊어졌어요' }),
    ).toBeInTheDocument()
    // 판정은 공유 Query 를 묻는다(U4 r4 M06). 취소돼 돌아온 값은 답이 아니라 같은 세션 안에서 한 번 더 묻는다 (fetchFresh) —
    // 3·4회차의 직접 요청은 취소되지 않아 1회였다
    expect(integrationRequests(log)).toHaveLength(2)
    expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
    // 처리 화면에서 회의록 목록으로 옮겼다. U5 부터 목록은 가장 최근 회의록(mt_09)으로 주소를 바꾼다 (D-106, U5-1)
    await app.expectPath(paths.meetings('ws_01', 'mt_09'))
    expect(app.visited().map(({ pathname }) => pathname)).toContain(paths.meetings('ws_01'))
  })
})

/*
 * U4 r2 M03 — 연동 캐시(connected)가 이미 있고 그 조회를 구독하던 마지막 화면(설정)이 떠나면, TanStack Query 는 진행 중
 * 요청을 취소하고 취소를 던지는 대신 이전 값(connected)을 돌려준다. 그 값을 새 답으로 믿으면 끊김을 일반 실패로 알린다.
 * 실제 Chromium 재현과 같은 모양이다 — 설정에서 연결됨을 본 뒤, 판정 조회를 붙잡고 헤더의 태스크로 간다.
 */
describe('설정 화면을 떠나도 정리 실패의 끊김 판정은 새 답을 기다린다 (U4 r2 M03)', () => {
  it.each([
    ['설정을 떠나 연동 구독이 모두 내려가도', true],
    ['대조군 — 설정에 그대로 있으면', false],
  ])(
    '%s 늦게 온 revoked 로 재연결 모달을 띄운다 — 일반 실패 토스트 없음',
    async (_label, leave) => {
      fakeIntervals()
      const show = vi.spyOn(toast, 'show')
      const log = recordRequests()
      const user = userEvent.setup()
      const app = renderApp(paths.settings('ws_01'), { strict: true })
      // 연동 캐시(connected)와 그 조회의 구독(설정의 Notion 영역)이 생긴다. 추적기는 공간의 목록에서 mt_10 을 찾는다
      const area = within(await screen.findByTestId('notion-connection'))
      expect(await area.findByText('연결됨')).toBeInTheDocument()
      await until(() =>
        expect(useMeetingTrackerStore.getState().meetings).toEqual([
          { workspaceId: 'ws_01', meetingId: 'mt_10' },
        ]),
      )
      const before = integrationRequests(log).length

      // 판정이 다시 묻는 조회까지 풀 때까지 붙잡는다
      const answer = holdIntegrations(undefined, { every: true })
      failMeeting('mt_10', { notionRevoked: true })
      await nextPoll()
      await until(() => expect(integrationRequests(log)).toHaveLength(before + 1))

      if (leave) {
        await user.click(headerLink('태스크'))
        expect(await screen.findByRole('heading', { name: '태스크' })).toBeInTheDocument()
        expect(screen.queryByTestId('notion-connection')).toBeNull()
        // 구독이 내려가 판정 조회가 취소되고 이전 값(connected)이 돌아왔다. 그것을 답으로 치지 않고 같은 Query 를 다시 묻는다
        // (fetchFresh). 그 답이 오기 전에는 아무것도 알리지 않는다
        await until(() => expect(integrationRequests(log)).toHaveLength(before + 2))
        await act(() => settle())
        expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
        expect(screen.queryByRole('dialog')).toBeNull()
      }

      answer.resolve()
      expect(
        await screen.findByRole('dialog', { name: 'Notion 연결이 끊어졌어요' }),
      ).toBeInTheDocument()
      await act(() => settle())
      expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
      expect(toastsWith(PROCESSING_FAILED_TITLE)).toHaveLength(0)
      // 판정의 답이 곧 연동 캐시의 값이다 — 다시 그리는 설정·업로드가 끊김을 본다
      expect(
        app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status,
      ).toBe('revoked')
      // 떠났을 때만 한 번 더 물었다
      expect(integrationRequests(log)).toHaveLength(before + (leave ? 2 : 1))
      // 처리 화면이 아니었으니 옮기지 않는다
      expect(pathsOf(app).at(-1)).toBe(leave ? paths.tasks('ws_01') : paths.settings('ws_01'))
    },
  )
})

/*
 * U4 r3 M04 — 3회차의 직접 요청은 세션 정리의 cancelQueries 가 닿지 않았다. 이전 세션에서 보낸 요청이 다시 로그인한 뒤에 401 을 받으면,
 * 전역 401 처리(client → createApp → expireSession)가 호출자의 세대 검사보다 먼저 새 세션을 끝냈다.
 * 지금은 두 겹으로 막는다 — 판정 조회는 공유 Query 라 세션 정리의 cancelQueries 가 거두고 끝난 세션에서 다시 묻지 않으며
 * (fetchFresh, U4 r4 M06), 공통 요청은 출발 세대가 지금 세대일 때만 401 을 알린다(request, sessionScope). 둘 다 없던 r3 코드에서는
 * 이 검사가 로그인 화면으로 떨어져 실패한다. 401 알림 거르기만 따로 보는 검사는 업로드 POST(취소되지 않는다) 쪽에 있다.
 */
describe('이전 세션 요청의 늦은 401 이 다시 로그인한 새 세션을 끝내지 않는다 (U4 r3 M04)', () => {
  it('끊김 판정 조회를 기다리는 사이 로그아웃·재로그인하면, 그 조회의 늦은 401 뒤에도 새 세션이 이어진다', async () => {
    fakeIntervals()
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openProcessing()

    // 이전 세션의 자격으로 보낸 판정 조회. 서버는 401 을 답했지만 그 답이 늦게 온다
    const answer = holdIntegrations(UNAUTHENTICATED)
    failMeeting('mt_10', { notionRevoked: true })
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(1))

    await logOut(user)
    await logIn(user)
    answer.resolve()
    await act(() => settle(200))

    expectSessionKept(app)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
  })

  it('대조군 — 지금 세션에서 보낸 판정 조회가 401 이면 그대로 세션을 끝내고 로그인으로 간다', async () => {
    fakeIntervals()
    const log = recordRequests()
    const app = await openProcessing()

    const answer = holdIntegrations(UNAUTHENTICATED)
    failMeeting('mt_10', { notionRevoked: true })
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(1))

    answer.resolve()
    await screen.findByRole('heading', { name: '로그인' })
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
  })
})

/*
 * U4 r3 M05 — 먼저 출발한 공유 연동 조회(설정의 구독)의 connected 답이, 그 뒤 끊김 판정이 직접 받아 캐시에 쓴 revoked 를
 * 늦게 와서 되돌렸다. 재연결 모달은 뜨지만 설정이 연결됨으로 돌아가 PM 의 재연결 버튼이 사라진다(U3-3 회귀).
 * 실제 Chromium 재현과 같은 두 길 — 캐시 무효화, 30초(기본 staleTime)가 지난 뒤 창 포커스의 재조회.
 */
describe('먼저 출발한 공유 연동 조회의 늦은 답이 끊김을 되돌리지 못한다 (U4 r3 M05)', () => {
  const realNow = Date.now.bind(Date)

  it.each([
    [
      '캐시 무효화로 다시 묻는 중',
      (app: ReturnType<typeof renderApp>) => {
        void app.queryClient.invalidateQueries({
          queryKey: integrationsQueryOptions('ws_01').queryKey,
        })
      },
    ],
    [
      '30초가 지나 창 포커스로 다시 묻는 중',
      () => {
        const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 31_000)
        onTestFinished(() => now.mockRestore())
        window.dispatchEvent(new Event('visibilitychange'))
      },
    ],
  ])(
    '%s 끊김이 나도 설정은 연결 끊김과 PM 재연결 버튼을 그대로 보인다',
    async (_label, refetchShared) => {
      fakeIntervals()
      const log = recordRequests()
      const user = userEvent.setup()
      const app = renderApp(paths.settings('ws_01'), { strict: true })
      const area = () => within(screen.getByTestId('notion-connection'))
      expect(
        await within(await screen.findByTestId('notion-connection')).findByText('연결됨'),
      ).toBeInTheDocument()
      await until(() =>
        expect(useMeetingTrackerStore.getState().meetings).toEqual([
          { workspaceId: 'ws_01', meetingId: 'mt_10' },
        ]),
      )
      const before = integrationRequests(log).length

      // 설정의 공유 조회가 먼저 출발한다. 서버는 그때의 상태(connected)로 답했지만 그 답이 늦게 온다
      const shared = holdSnapshot(INTEGRATIONS)
      act(() => refetchShared(app))
      await until(() => expect(integrationRequests(log)).toHaveLength(before + 1))

      // 그 뒤 정리가 끊김으로 실패한다. 판정은 먼저 출발한 공유 조회를 거두고 새로 물어 바로 revoked 를 받는다(fetchFresh)
      failMeeting('mt_10', { notionRevoked: true })
      await nextPoll()
      const dialog = await screen.findByRole('dialog', { name: 'Notion 연결이 끊어졌어요' })
      expect(integrationRequests(log)).toHaveLength(before + 2)
      expect(area().getByText('연결 끊김')).toBeInTheDocument()

      // 먼저 출발한 공유 조회의 connected 답이 이제 온다
      shared.resolve()
      await act(() => settle(200))
      expect(
        app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status,
      ).toBe('revoked')
      expect(area().getByText('연결 끊김')).toBeInTheDocument()
      // 모달이 열려 있어 뒤 화면은 접근성 트리에서 가려져 있다
      expect(
        area().getByRole('button', { name: 'Notion 다시 연결하기', hidden: true }),
      ).toBeInTheDocument()

      // 모달의 재연결을 따라가도 같은 설정에서 재연결 버튼이 있다 — 새 조회 없이 같은 캐시를 그린다
      await user.click(within(dialog).getByRole('button', { name: 'Notion 다시 연결하기' }))
      await app.expectPath(paths.settings('ws_01'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(area().getByRole('button', { name: 'Notion 다시 연결하기' })).toBeInTheDocument()
      expect(area().queryByText('회의 올리기로 돌아가기')).toBeNull()
    },
  )
})

/*
 * U4 r4 M06 — M05 의 반대 순서. 끊김 판정이 먼저 출발해 기다리는 사이 서버의 연결이 끊기고, 뒤에 출발한 공유 조회가 revoked 를
 * 먼저 받는다. 4회차는 판정이 직접 받은 이전 답(connected)을 늦게 캐시에 써 그 revoked 를 덮었다 — 설정이 연결됨으로 돌아가 PM 의
 * 재연결 버튼이 사라졌다. 지금 판정은 따로 요청하지 않고 같은 공유 Query 를 묻는다(fetchFresh). 캐시에 쓰는 길이 하나다.
 * - 무효화: 뒤의 조회가 앞 판정 조회를 거두고(cancelRefetch) 새로 묻는다. 판정도 그 새 답을 받는다.
 * - 창 포커스: 진행 중 조회가 있으면 거기 합쳐진다(cancelRefetch: false). 뒤에 출발하는 조회가 없어 덮어쓸 순서가 없다 —
 *   판정의 답이 유일한 답이고, 그 뒤 서버의 끊김은 다음 조회가 가져온다 (알려진 동작, impl-decision 개정 절)
 */
describe('먼저 출발한 판정 조회의 이전 답이 뒤에 받은 끊김을 덮지 못한다 (U4 r4 M06)', () => {
  const realNow = Date.now.bind(Date)

  /** 설정에서 연결됨을 본 뒤, 일반 실패의 판정 조회를 그 요청 시점 답(connected)으로 붙잡고 서버의 연결을 끊는다 */
  async function holdJudgementThenRevoke() {
    fakeIntervals()
    const show = vi.spyOn(toast, 'show')
    const log = recordRequests()
    const user = userEvent.setup()
    const app = renderApp(paths.settings('ws_01'), { strict: true })
    const area = () => within(screen.getByTestId('notion-connection'))
    expect(
      await within(await screen.findByTestId('notion-connection')).findByText('연결됨'),
    ).toBeInTheDocument()
    await until(() =>
      expect(useMeetingTrackerStore.getState().meetings).toEqual([
        { workspaceId: 'ws_01', meetingId: 'mt_10' },
      ]),
    )
    const before = integrationRequests(log).length

    // 정리는 끊김과 무관하게 실패했다. 판정 조회가 먼저 출발하고, 서버는 그때의 상태(connected)로 답했지만 그 답이 늦게 온다
    const judgement = holdSnapshot(INTEGRATIONS)
    failMeeting('mt_10', { notionRevoked: false })
    await nextPoll()
    await until(() => expect(integrationRequests(log)).toHaveLength(before + 1))
    // 판정을 기다리는 사이 서버의 Notion 연결이 끊긴다
    db.integrations.ws_01.notion = { ...db.integrations.ws_01.notion, status: 'revoked' }

    const cached = () =>
      app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status
    const requests = () => integrationRequests(log).length - before
    return { show, user, app, area, judgement, cached, requests }
  }

  it('캐시 무효화로 뒤에 출발한 조회가 끊김을 먼저 받으면, 판정의 이전 답이 늦게 와도 설정은 연결 끊김과 PM 재연결 버튼을 그대로 보인다', async () => {
    const { show, user, app, area, judgement, cached, requests } = await holdJudgementThenRevoke()

    // 뒤에 출발한 공유 조회가 앞 판정 조회를 거두고 바로 revoked 를 받는다. 판정도 그 답을 받는다
    act(() => {
      void app.queryClient.invalidateQueries({
        queryKey: integrationsQueryOptions('ws_01').queryKey,
      })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Notion 연결이 끊어졌어요' })
    expect(requests()).toBe(2)
    expect(cached()).toBe('revoked')
    expect(area().getByText('연결 끊김')).toBeInTheDocument()

    // 먼저 출발한 판정 조회의 connected 답이 이제 온다. 거둔 조회라 캐시에 닿지 않는다
    judgement.resolve()
    await act(() => settle(200))
    expect(cached()).toBe('revoked')
    expect(area().getByText('연결 끊김')).toBeInTheDocument()
    expect(area().queryByText('연결됨')).toBeNull()
    expect(
      area().getByRole('button', { name: 'Notion 다시 연결하기', hidden: true }),
    ).toBeInTheDocument()
    expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(0)
    expect(requests()).toBe(2)

    await user.click(within(dialog).getByRole('button', { name: 'Notion 다시 연결하기' }))
    await app.expectPath(paths.settings('ws_01'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(area().getByRole('button', { name: 'Notion 다시 연결하기' })).toBeInTheDocument()
  })

  it('30초가 지나 창 포커스로 다시 묻는 것은 진행 중 판정 조회에 합쳐진다 — 캐시·화면·판정이 그 한 답으로 같고, 다음 조회가 끊김과 PM 재연결 버튼을 가져온다', async () => {
    const { show, app, area, judgement, cached, requests } = await holdJudgementThenRevoke()

    const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 31_000)
    onTestFinished(() => now.mockRestore())
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => settle(200))
    // 뒤에 출발하는 조회가 없다 — 덮어쓸 순서가 생기지 않는다
    expect(requests()).toBe(1)

    judgement.resolve()
    await waitFor(() => expect(shownWith(show, PROCESSING_FAILED_TITLE)).toHaveLength(1))
    // 받은 답은 판정 조회의 그 한 답(요청 시점 connected)뿐이다. 판정·캐시·설정이 모두 그 값이다
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cached()).toBe('connected')
    expect(area().getByText('연결됨')).toBeInTheDocument()
    expect(requests()).toBe(1)

    // 다음 조회 한 번이 그 뒤의 끊김을 가져온다
    act(() => {
      void app.queryClient.invalidateQueries({
        queryKey: integrationsQueryOptions('ws_01').queryKey,
      })
    })
    expect(await area().findByText('연결 끊김')).toBeInTheDocument()
    expect(cached()).toBe('revoked')
    expect(area().getByRole('button', { name: 'Notion 다시 연결하기' })).toBeInTheDocument()
    expect(requests()).toBe(2)
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
    const app = renderApp(
      withOAuthResult(paths.settingsNotion('ws_01', UPLOAD_PATH), 'notion', 'success'),
      { strict: true },
    )
    const area = within(await screen.findByTestId('notion-connection'))
    expect(await area.findByText('연결을 확인하고 있어요.')).toBeInTheDocument()
    return { answer, user, app }
  }

  it('Notion 복귀 확인 중 팀 화면으로 가는 중(화면 코드 대기)이면 끝나도 업로드로 데려오지 않는다', async () => {
    const { answer, user, app } = await openVerifying()
    const paint = holdFirstPaints()
    await user.click(headerLink('팀'))
    expect(screen.getByTestId('notion-connection')).toBeInTheDocument()

    answer.resolve()
    await waitFor(() =>
      expect(
        app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.notion.status,
      ).toBe('connected'),
    )
    await act(() => settle())

    paint.release()
    expect(await screen.findByRole('heading', { name: '팀원' })).toBeInTheDocument()
    await act(() => settle())
    expect(pathsOf(app).at(-1)).toBe(paths.members('ws_01'))
    expect(pathsOf(app)).not.toContain(UPLOAD_PATH)
  })

  it('Notion 복귀 확인 중 로그아웃하면 이전 사용자의 연동 상태를 캐시에 다시 쓰지 않고 옮기지도 않는다', async () => {
    const { answer, user, app } = await openVerifying()
    await logOut(user)

    answer.resolve()
    await act(() => settle(200))
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(integrationsQueryOptions('ws_01').queryKey)).toBeUndefined()
    expect(pathsOf(app)).not.toContain(UPLOAD_PATH)
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
    expect(await screen.findByRole('heading', { name: '확인 필요' })).toBeInTheDocument()
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
