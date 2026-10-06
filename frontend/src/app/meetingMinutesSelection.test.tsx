import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { minutesQueryOptions } from '@/entities/minutes'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import {
  MINUTES_DIM_DELAY_MS,
  MINUTES_HOLD_MS,
  MINUTES_SKELETON_MIN_MS,
} from '@/widgets/meeting-minutes'
import { renderApp } from './test/renderApp'

/*
 * UX1 — 회의록에서 다른 회의를 고를 때의 로딩 (docs/impl-decision/2026-10-06-minutes-skeleton-and-selection.md).
 * - 빠른 답(미리 받았거나 MINUTES_HOLD_MS 안의 응답)은 스켈레톤을 거치지 않고 바로 바뀐다
 * - 느린 답은 MINUTES_HOLD_MS 뒤 실제 본문 모양의 스켈레톤을 그리고, 이전 회의 내용을 남기지 않는다
 * - 고른 순간부터 본문 머리(제목)는 고른 회의다. 들고 있는 이전 본문은 MINUTES_DIM_DELAY_MS 뒤 흐려진다 (UX1-M02)
 * - 목록 행을 가리키거나 포커스하면 그 회의록을 미리 받는다 — U5-4(다른 공간의 회의는 본문·추출 0회)와
 *   U5-6(일반 팀원·권한 없는 회의록은 승인 목록 0회)을 그대로 지킨다
 * 픽스처의 ws_01: 정리 끝난 mt_09(3주차, 추출 ex_01)·mt_07(2주차, 추출 ex_00 — 0건), 정리 중 mt_10.
 *
 * 시간 — 들고 있기 · 뼈대 타이머가 걸린 검사는 회의록을 연 뒤 setTimeout 을 가짜로 바꾸고(`fakeClock`), 답은 문(deferred)으로
 * 정한 가짜 시각에 보낸다. 실제 경과 시간 · 페인트에 기대지 않아 전체 실행 부하와 상관없이 같은 결과다 (UX1-T01).
 * 실제 프레임 · 밀리초(흐림이 실제로 보이는지, 실제 브라우저의 상한 근처 답)는 e2e/meeting-skeleton.e2e.ts 가 Chromium 에서 본다.
 */

vi.setConfig({ testTimeout: 10_000 })

afterEach(() => {
  vi.useRealTimers()
  notifyManager.setScheduler(defaultScheduler)
  clearTrackedMeetings()
})

const MT_09 = paths.meetings('ws_01', 'mt_09')
const MT_07 = paths.meetings('ws_01', 'mt_07')
const SKELETON = '[data-testid="minutes-detail-skeleton"]'

type Log = ReturnType<typeof recordRequests>
const requestsOf = (log: Log, pattern: RegExp) =>
  log.started.filter(({ path }) => pattern.test(path)).map(({ path }) => path)

const settle = (ms = 80) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

/**
 * 이 뒤로 setTimeout 과 Date 가 가짜다 — 들고 있기 · 뼈대 타이머는 `advance` 로만 간다. setImmediate(React 스케줄러)는 진짜다.
 * Query 의 알림 묶음(기본은 setTimeout 0)은 진짜 다음 틱(setImmediate)으로 옮긴다 — 가짜 시계에서는 진행 중에 건 0ms 타이머가
 * 1ms 뒤로 밀려, 답이 화면에 닿는 데 가짜 시간이 들었다. 답이 닿는 일과 시간 규칙을 떼어 보려는 것이다.
 * 가짜 setTimeout 아래에서는 RTL 의 waitFor · findBy 가 끝에 setTimeout(0) 을 기다려 멈춘다 — 이 뒤로는 쓰지 않는다
 */
function fakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  notifyManager.setScheduler((callback) => void setImmediate(callback))
}

/** 누르기는 act 안이라 주소가 이미 적혔다 — 가짜 시계에서는 기다리지 않고 지금 주소를 본다 */
function expectPathNow(app: ReturnType<typeof renderApp>, pathname: string) {
  expect(app.visited().at(-1)?.pathname).toBe(pathname)
}

/** 가짜 시간을 ms 만큼 보낸다. 그 사이 타이머와 그 뒤의 렌더 · 효과까지 끝낸다 */
async function advance(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

/**
 * 가짜 시간을 멈춘 채 답이 화면에 닿을 때까지 돌린다 — 지금 시각 그대로 답이 온 것이다. 0ms 타이머(Query 의 알림 묶음)와
 * 진짜 비동기 일(MSW · XHR · React 스케줄러)만 돈다. 들고 있기 · 뼈대 타이머는 시각이 그대로라 끼어들지 못한다
 */
async function deliver(arrived: () => boolean) {
  for (let round = 0; round < 200 && !arrived(); round += 1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      await new Promise((resolve) => setImmediate(resolve))
    })
  expect(arrived()).toBe(true)
}

/** 고른 회의의 회의록이 다 그려졌다 — 회의록에서만 오는 참석자 이름 목록과 그 회의의 추출 탭이 있고 기다리는 표시가 없다 */
const minutesArrived = () =>
  within(detail()).queryByRole('list', { name: '참석자' }) !== null &&
  within(detail()).queryByRole('tab', { name: /추출된 일 \d/ }) !== null &&
  detail().querySelector('[aria-busy="true"]') === null

function detail() {
  return screen.getByRole('region', { name: '회의록 본문' })
}
function rowLink(name: RegExp) {
  return within(
    within(screen.getByRole('complementary', { name: '회의 목록' })).getByRole('list', {
      name: '정리된 회의',
    }),
  ).getByRole('link', { name })
}
async function openMt09() {
  const app = renderApp(MT_09)
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
  // 추출·승인까지 받은 뒤 — 미리 받기의 요청만 세려고
  await screen.findByRole('tab', { name: /추출된 일 \d/ })
  return app
}

/**
 * 회의록 본문에 스켈레톤이 한 번이라도 붙었는지 지켜본다. 붙었다 곧 떨어져도 잡도록 지금 DOM 이 아니라 기록의 붙은 노드를 본다
 * (콜백이 돌 때는 이미 떨어졌을 수 있다)
 */
function watchSkeleton() {
  let seen = document.querySelector(SKELETON) !== null
  const observer = new MutationObserver((records) => {
    for (const { addedNodes } of records)
      for (const node of addedNodes)
        if (node instanceof Element && (node.matches(SKELETON) || node.querySelector(SKELETON)))
          seen = true
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return {
    seen: () => {
      for (const record of observer.takeRecords())
        for (const node of record.addedNodes)
          if (node instanceof Element && (node.matches(SKELETON) || node.querySelector(SKELETON)))
            seen = true
      return seen
    },
    stop: () => observer.disconnect(),
  }
}

/** 이 회의의 상세 GET 을 붙잡는다. 답은 요청을 받은 순간의 서버 상태다 */
function holdDetail(meetingId: string) {
  const gate = deferred()
  server.use(
    http.get(`/api/v1/meetings/${meetingId}`, async ({ request }) => {
      const snapshot = await getResponse(handlers, request.clone())
      await gate.promise
      return snapshot
    }),
  )
  return gate
}

describe('회의를 고를 때 빠른 답은 스켈레톤 없이 바뀐다 (UX1)', () => {
  it('목록에서 다른 회의를 고르면 스켈레톤을 거치지 않고 새 회의록이 뜬다 — 연달아 골라도 같다', async () => {
    await openMt09()
    fakeClock()
    const watch = watchSkeleton()

    // 답이 가짜 시간 0ms 에 온다 — 들고 있기 상한 안이다. 처음 보는 회의(2주차)와 이미 받은 회의(3주차) 모두
    for (const title of ['2주차 정기회의', '3주차 정기회의', '2주차 정기회의']) {
      fireEvent.click(rowLink(new RegExp(title)))
      await deliver(
        () =>
          minutesArrived() &&
          within(detail()).queryByRole('heading', { level: 2, name: title }) !== null,
      )
    }

    expect(watch.seen()).toBe(false)
    watch.stop()
  })

  it('잠깐 늦은 답은 머리를 고른 회의로 바꾸고 이전 본문만 흐리게 묶어 두고 기다린다 — 스켈레톤이 없고 탭은 새 회의에서 처음 탭이다', async () => {
    const user = userEvent.setup()
    const app = await openMt09()
    await user.click(screen.getByRole('tab', { name: '전사문' }))
    const gate = holdDetail('mt_07')
    fakeClock()
    const watch = watchSkeleton()

    // 가리키기 없이 누른다 — 미리 받기를 거치지 않는 경로(터치 등)
    fireEvent.click(rowLink(/2주차 정기회의/))
    expectPathNow(app, MT_07)
    // 상한 바로 전 — 아직 들고 있다
    await advance(MINUTES_HOLD_MS - 1)

    // 주소·목록 표시·본문 머리가 모두 새 회의다 — 기대값을 바꿨다. 1회차는 머리도 이전 회의(3주차)였는데, 주소·선택 표시와
    // 보이는 제목이 어긋나 이전 회의 내용이 새 회의로 오인됐다 (UX1-M02). 머리는 목록 요약(참석자는 수)으로 그린다
    expect(rowLink(/2주차 정기회의/)).toHaveAttribute('aria-current', 'page')
    expect(rowLink(/3주차 정기회의/)).not.toHaveAttribute('aria-current')
    expect(
      within(detail()).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
    expect(within(detail()).queryByRole('heading', { name: '3주차 정기회의' })).toBeNull()
    expect(within(detail()).getByText(/^참석자 \d+명$/)).toBeInTheDocument()
    // 이전 본문은 흐리게 · aria-busy · inert 로 묶여 있다. 흐림은 MINUTES_DIM_DELAY_MS 뒤에 바뀐다(짧은 답에는 보이지 않는다)
    const held = within(detail()).getByTestId('minutes-body')
    expect(held).toHaveAttribute('aria-busy', 'true')
    expect(held).toHaveAttribute('inert')
    expect(held).toHaveClass('opacity-55', 'transition-opacity', 'duration-0')
    expect(held.style.transitionDelay).toBe(`${MINUTES_DIM_DELAY_MS}ms`)
    // 이전 회의의 탭 상태가 바뀌지 않는다(다시 마운트하지 않는다)
    expect(screen.getByRole('tab', { name: '전사문' })).toHaveAttribute('aria-selected', 'true')
    expect(watch.seen()).toBe(false)

    // 상한 1ms 전에 답이 온다
    gate.resolve()
    await deliver(minutesArrived)
    expect(
      within(detail()).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
    expect(within(detail()).queryByRole('heading', { name: '3주차 정기회의' })).toBeNull()
    expect(detail().querySelector('[inert]')).toBeNull()
    // 대기 표시는 들고 있는 동안만이다
    expect(within(detail()).getByTestId('minutes-body')).not.toHaveClass('opacity-55')
    // 회의가 바뀌면 처음 탭(요약)으로 돌아간다 (U5)
    expect(screen.getByRole('tab', { name: '요약' })).toHaveAttribute('aria-selected', 'true')
    expect(watch.seen()).toBe(false)
    watch.stop()
  })
})

describe('느린 답은 본문 모양의 스켈레톤을 그리고 이전 회의를 남기지 않는다 (UX1)', () => {
  it('기다림이 길어지면 이전 회의록 대신 스켈레톤 — 제목·주소·목록 표시가 어긋난 채 남지 않는다', async () => {
    const app = await openMt09()
    const gate = holdDetail('mt_07')
    fakeClock()

    fireEvent.click(rowLink(/2주차 정기회의/))
    expectPathNow(app, MT_07)

    // 들고 있는 시간이 지난 뒤에야 그린다 — 바로 전에는 없고, 그 시각에 있다
    await advance(MINUTES_HOLD_MS - 1)
    expect(within(detail()).queryByTestId('minutes-detail-skeleton')).toBeNull()
    await advance(1)
    const skeleton = within(detail()).getByTestId('minutes-detail-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    // 이전 회의 내용이 하나도 없다
    expect(within(detail()).queryByRole('heading', { name: '3주차 정기회의' })).toBeNull()
    expect(within(detail()).queryByRole('tablist')).toBeNull()
    expect(detail().querySelector('[inert]')).toBeNull()
    expect(rowLink(/2주차 정기회의/)).toHaveAttribute('aria-current', 'page')
    // 기대값을 바꿨다 — 뼈대의 머리는 머리 뼈대가 아니라 고른 회의의 목록 요약이다. 들고 있는 동안 이미 그 머리였으므로
    // 넘어갈 때 머리가 요약 → 뼈대로 돌아가 깜빡이지 않는다 (UX1-M02)
    expect(
      within(skeleton).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
    expect(within(skeleton).queryByTestId('minutes-detail-skeleton-title')).toBeNull()
    // 실제 본문과 같은 배치 — 탭 줄 자리가 있다
    expect(within(skeleton).getByTestId('minutes-detail-skeleton-tabs')).toHaveClass(
      'border-b',
      'px-36',
    )

    // 상한을 막 넘겨(1ms 뒤) 답이 와도, 그린 뼈대는 최소 시간 동안 둔다 — 수십 ms 만 보였다 사라지지 않는다 (UX1-N03)
    await advance(1)
    gate.resolve()
    const minutesKey = minutesQueryOptions('ws_01', 'mt_07').queryKey
    await deliver(() => app.queryClient.getQueryData(minutesKey) !== undefined)
    expect(within(detail()).getByTestId('minutes-detail-skeleton')).toBeInTheDocument()
    await advance(MINUTES_SKELETON_MIN_MS - 2)
    expect(within(detail()).getByTestId('minutes-detail-skeleton')).toBeInTheDocument()
    // 뼈대를 그린 때부터 MINUTES_SKELETON_MIN_MS — 그때 회의록이다
    await advance(1)
    await deliver(minutesArrived)
    expect(
      within(detail()).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
    expect(within(detail()).queryByTestId('minutes-detail-skeleton')).toBeNull()
  })

  it('늦은 상세가 다른 공간의 회의면 볼 수 없는 회의로 안내하고 본문·추출 요청이 0회다 (U5-4)', async () => {
    const app = await openMt09()
    server.use(
      http.get('/api/v1/meetings/mt_07', () => {
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_07')!
        return ok({ ...meeting, workspace_id: 'ws_02' })
      }),
    )
    const log = recordRequests()

    fireEvent.click(rowLink(/2주차 정기회의/))
    await app.expectPath(MT_07)
    expect(
      await within(detail()).findByRole('heading', { level: 2, name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    expect(within(detail()).queryByRole('heading', { name: '3주차 정기회의' })).toBeNull()
    await settle(150)
    expect(requestsOf(log, /^\/meetings\/mt_07$/)).toEqual(['/meetings/mt_07'])
    expect(requestsOf(log, /\/minutes$/)).toEqual([])
    expect(requestsOf(log, /^\/extractions\//)).toEqual([])
  })
})

describe('목록 행을 가리키거나 포커스하면 그 회의록을 미리 받는다 (UX1)', () => {
  it('PM — 가리키면 상세·본문·추출을 받고, 고른 뒤에는 다시 묻지 않고 스켈레톤 없이 그린다', async () => {
    const user = userEvent.setup()
    await openMt09()
    const log = recordRequests()

    await user.hover(rowLink(/2주차 정기회의/))
    await waitFor(() =>
      expect(requestsOf(log, /mt_07|ex_00/)).toEqual([
        '/meetings/mt_07',
        '/extractions/ex_00',
        '/meetings/mt_07/minutes',
      ]),
    )
    await settle()
    // 이 공간의 대기 승인은 mt_09 를 볼 때 받아 아직 최신이다 — 다시 받지 않는다
    expect(requestsOf(log, /^\/approvals/)).toEqual([])

    const watch = watchSkeleton()
    await user.click(rowLink(/2주차 정기회의/))
    expect(
      within(detail()).getByRole('heading', { level: 2, name: '2주차 정기회의' }),
    ).toBeInTheDocument()
    await settle()
    expect(watch.seen()).toBe(false)
    watch.stop()
    expect(requestsOf(log, /mt_07|ex_00/)).toHaveLength(3)
  })

  it('키보드로 포커스해도 미리 받는다', async () => {
    await openMt09()
    const log = recordRequests()

    act(() => rowLink(/2주차 정기회의/).focus())
    await waitFor(() =>
      expect(requestsOf(log, /mt_07/)).toEqual(['/meetings/mt_07', '/meetings/mt_07/minutes']),
    )
  })

  it('일반 팀원은 미리 받을 때도 승인 목록을 요청하지 않는다 (U5-6)', async () => {
    setMockRole('member')
    const user = userEvent.setup()
    const log = recordRequests()
    await openMt09()

    await user.hover(rowLink(/2주차 정기회의/))
    await waitFor(() => expect(requestsOf(log, /\/meetings\/mt_07\/minutes$/)).toHaveLength(1))
    await user.click(rowLink(/2주차 정기회의/))
    await within(detail()).findByRole('heading', { level: 2, name: '2주차 정기회의' })
    await settle(150)
    expect(requestsOf(log, /^\/approvals/)).toEqual([])
  })

  it('PM 이어도 서버가 회의록 권한을 주지 않으면 미리 받을 때 승인 목록을 부르지 않는다 (U5-6)', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId/minutes', ({ params }) => {
        const minutes = db.minutes.find(({ meeting_id }) => meeting_id === params.meetingId)!
        return ok({ ...minutes, permissions: { can_review: false, can_undo: false } })
      }),
    )
    const user = userEvent.setup()
    const log = recordRequests()
    renderApp(MT_09)
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })

    await user.hover(rowLink(/2주차 정기회의/))
    await waitFor(() => expect(requestsOf(log, /\/meetings\/mt_07\/minutes$/)).toHaveLength(1))
    await settle(150)
    expect(requestsOf(log, /^\/approvals/)).toEqual([])
  })

  it('상세가 다른 공간의 회의면 미리 받을 때도 본문·추출 요청이 0회다 (U5-4)', async () => {
    server.use(
      http.get('/api/v1/meetings/mt_07', () => {
        const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_07')!
        return ok({ ...meeting, workspace_id: 'ws_02' })
      }),
    )
    const user = userEvent.setup()
    await openMt09()
    const log = recordRequests()

    await user.hover(rowLink(/2주차 정기회의/))
    await waitFor(() => expect(requestsOf(log, /^\/meetings\/mt_07$/)).toHaveLength(1))
    await settle(150)
    expect(requestsOf(log, /\/meetings\/mt_07\/minutes$/)).toEqual([])
    expect(requestsOf(log, /^\/extractions\//)).toEqual([])
  })
})

interface Frame {
  /** 가짜 시계(Date)의 시각 — 누른 때부터의 ms 로 바꿔 본다 */
  at: number
  /** 목록에서 aria-current 인 회의 제목 */
  current: string | null
  /** 본문 머리에 보이는 제목 */
  title: string | null
  skeleton: boolean
  /** 이전 본문을 들고 있다 (aria-busy · inert) */
  held: boolean
  /** 들고 있는 본문의 흐림 표시 */
  dimmed: boolean
  /** 본문 첫 탭 패널의 글자 — 어느 회의의 본문인지 */
  panel: string | null
}

/**
 * DOM 이 바뀔 때마다 화면 상태를 적는다. MutationObserver 콜백은 커밋 뒤 마이크로태스크에서 돈다 — 브라우저는 태스크 사이에만
 * 그리므로, 그려질 수 있는 모든 상태가 여기 적힌 상태 안에 있다(그 이상을 적을 수는 있어도 놓치지는 않는다).
 * 시각은 가짜 시계다 — 화면이 바뀐 순서와 그 가짜 시각만 본다. 실제로 그려진 프레임의 시간은 Chromium E2E 가 본다
 */
function recordFrames() {
  const frames: Frame[] = []
  const snap = () => {
    const region = document.querySelector('section[aria-label="회의록 본문"]')
    const body = region?.querySelector('[data-testid="minutes-body"]')
    frames.push({
      at: Date.now(),
      current:
        document.querySelector('ul[aria-label="정리된 회의"] [aria-current="page"] span')
          ?.textContent ?? null,
      title: region?.querySelector('h2')?.textContent ?? null,
      skeleton: region?.querySelector(SKELETON) != null,
      held: body?.getAttribute('aria-busy') === 'true',
      dimmed: body?.classList.contains('opacity-55') ?? false,
      panel: region?.querySelector('[role="tabpanel"]')?.textContent?.slice(0, 40) ?? null,
    })
  }
  const observer = new MutationObserver(snap)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  })
  snap()
  return {
    frames,
    stop: () => {
      if (observer.takeRecords().length > 0) snap()
      observer.disconnect()
    },
  }
}

/**
 * 상세 답이 오는 가짜 시각마다 화면이 거치는 길 — 들고 있기(머리는 고른 회의 · 본문은 이전 회의) → 상한이 지나면 본문 뼈대
 * (MINUTES_SKELETON_MIN_MS 는 둔다) → 회의록. 상한 안(0 · 180ms)이면 뼈대가 없고, 상한을 막 넘기면(260ms) 뼈대를 최소 시간
 * 두며, 한참 늦으면(650ms) 답이 오는 대로 바뀐다.
 * 3회차까지는 실제 시간으로 「들고 있기 < 100ms · < 350ms」를 쟀다 — 전체 실행 부하에서 어긋났다(UX1-T01). 이제 시각은 가짜
 * 시계가 정하고, 기대값은 규칙이 정한 정확한 시각이다(넓히지 않았다). 실제 프레임의 흐림 · 밀리초는 Chromium E2E 다.
 */
const LAGS: { lag: number; heldUntil: number; skeleton: { from: number; until: number } | null }[] =
  [
    { lag: 0, heldUntil: 0, skeleton: null },
    { lag: 180, heldUntil: 180, skeleton: null },
    {
      lag: MINUTES_HOLD_MS + 10,
      heldUntil: MINUTES_HOLD_MS,
      skeleton: { from: MINUTES_HOLD_MS, until: MINUTES_HOLD_MS + MINUTES_SKELETON_MIN_MS },
    },
    {
      lag: 650,
      heldUntil: MINUTES_HOLD_MS,
      skeleton: { from: MINUTES_HOLD_MS, until: 650 },
    },
  ]

describe('고른 순간부터 보이는 제목은 고른 회의다 — 화면이 바뀐 순서와 가짜 시각 (UX1-M02, UX1-N03)', () => {
  it.each(LAGS)(
    '상세 답이 $lag ms 에 와도 목록 선택 표시와 본문 머리 제목이 어긋난 순간이 없다 — 대기 표시는 들고 있는 동안만, 뼈대는 상한 뒤에만',
    async ({ lag, heldUntil, skeleton }) => {
      const app = await openMt09()
      const gate = holdDetail('mt_07')
      fakeClock()
      const record = recordFrames()

      // 가리키기 없이 누른다 — 미리 받기를 거치지 않는 경로(터치 등)
      const clickedAt = Date.now()
      fireEvent.click(rowLink(/2주차 정기회의/))
      expectPathNow(app, MT_07)
      // 답이 오는 시각까지 — 상한 · 뼈대 타이머가 그 사이에 있으면 그 시각에서 끊어 보낸다(타이머 뒤의 렌더 · 효과가 그 시각에 돈다)
      for (const stop of [MINUTES_HOLD_MS, lag].filter((at) => at <= lag).sort((x, y) => x - y)) {
        const now = Date.now() - clickedAt
        if (stop > now) await advance(stop - now)
      }
      gate.resolve()
      const minutesKey = minutesQueryOptions('ws_01', 'mt_07').queryKey
      await deliver(() => app.queryClient.getQueryData(minutesKey) !== undefined)
      // 뼈대를 두는 시간이 남았으면 그 끝까지
      const left = (skeleton?.until ?? 0) - (Date.now() - clickedAt)
      if (left > 0) await advance(left)
      await deliver(minutesArrived)
      record.stop()

      const frames = record.frames.map((frame) => ({ ...frame, at: frame.at - clickedAt }))
      const after = frames.filter(({ current }) => current === '2주차 정기회의')
      expect(after.length).toBeGreaterThan(0)
      for (const frame of after) {
        // 선택 표시가 새 회의인 모든 순간에 머리 제목도 새 회의다. 머리가 빈 순간도 없다
        expect(frame.title).toBe('2주차 정기회의')
        // 흐림은 들고 있는 본문에만 있다
        expect(frame.dimmed).toBe(frame.held)
      }
      // 선택 표시보다 머리가 먼저 바뀌거나 늦게 바뀌는 순간이 없다
      expect(
        frames.filter(
          ({ current, title }) => current === '3주차 정기회의' && title !== '3주차 정기회의',
        ),
      ).toEqual([])

      // 들고 있기 — 누른 때부터 정해진 시각까지 한 번뿐이고, 이전 본문(3주차의 패널)이다
      const held = after.filter((frame) => frame.held)
      if (heldUntil === 0) expect(held.every(({ at }) => at === 0)).toBe(true)
      else {
        expect(held.length).toBeGreaterThan(0)
        expect(held[0].at).toBe(0)
        expect(Math.max(...held.map(({ at }) => at))).toBeLessThan(heldUntil)
        const firstAfterHeld = after.find(({ held, at }) => !held && at > 0)
        expect(firstAfterHeld?.at).toBe(heldUntil)
      }
      const lastHeld = after.map(({ held }) => held).lastIndexOf(true)
      expect(after.slice(0, lastHeld + 1).every(({ held }) => held)).toBe(true)

      // 본문 뼈대 — 상한 안의 답이면 한 번도 없다. 아니면 상한에 붙고, 정해진 시각까지 끊기지 않으며, 이전 본문이 없다
      const skeletons = after.filter((frame) => frame.skeleton)
      if (skeleton === null) expect(skeletons).toEqual([])
      else {
        expect(skeletons[0].at).toBe(skeleton.from)
        for (const frame of skeletons) expect(frame).toMatchObject({ held: false, panel: null })
        const first = after.indexOf(skeletons[0])
        const last = after.indexOf(skeletons[skeletons.length - 1])
        expect(after.slice(first, last + 1).every((frame) => frame.skeleton)).toBe(true)
        // 뼈대가 걷히는 것은 정해진 시각이다 — 최소 시간이 차는 때(260ms 의 답) 또는 답이 오는 때(650ms 의 답).
        // 답이 오는 때는 상세 → 회의록 본문이 같은 시각에 차례로 와서 그 시각의 뼈대 기록이 있을 수 있다
        expect(Math.max(...skeletons.map(({ at }) => at))).toBeLessThanOrEqual(skeleton.until)
        expect(after[last + 1].at).toBe(skeleton.until)
      }
      // 마지막은 고른 회의의 회의록이다
      expect(after[after.length - 1]).toMatchObject({ skeleton: false, held: false })
      expect(after[after.length - 1].at).toBe(Math.max(lag, skeleton?.until ?? 0))
    },
  )
})
