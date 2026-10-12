import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import type { ComponentType } from 'react'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { handlers } from '@/shared/mock/handlers'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { renderApp } from './test/renderApp'

/*
 * M5 U5 — 회의록 기본 선택의 늦은 응답 (U3 r1 M02, U4 r1 M01·M02 와 같은 종류).
 * 기본 진입(`/meetings`)은 목록을 받은 뒤 가장 최근 회의록으로 주소를 바꾼다. 목록이 늦게 오는 사이 사용자가 다른 화면·공간으로
 * 가거나 로그아웃했으면 그 답이 사용자를 끌고 오거나 이전 공간·세션의 회의록을 보이면 안 된다.
 *
 * 사용자 이동이 지연 로드 화면을 기다리는 동안에는 기록은 새 경로인데 회의록 화면은 아직 마운트돼 있다(transition).
 * lateAsyncRaces.test.tsx 와 같이 경로 표의 지연 로드만 바꿔 끼워 「처음 그리는 화면」의 코드 도착을 붙잡는다.
 * 지연 로드는 화면마다 한 번이라 테스트마다 이 파일에서 아직 그리지 않은 화면으로 간다.
 */
const lazyGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('./router/lazyPage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./router/lazyPage')>()
  return {
    lazyPage: (load: () => Promise<ComponentType>) =>
      actual.lazyPage(async () => {
        const hold = lazyGate.hold
        const page = await load()
        if (hold) await hold
        return page
      }),
  }
})

vi.setConfig({ testTimeout: 10_000 })

afterEach(() => {
  lazyGate.hold = null
  clearTrackedMeetings()
})

const LIST_PATH = paths.meetings('ws_01')
const LATEST = paths.meetings('ws_01', 'mt_09')

const settle = (ms = 120) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const pathsOf = (app: ReturnType<typeof renderApp>) => app.visited().map(({ pathname }) => pathname)

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

/** 이 공간 회의 목록 GET 을 모두 붙잡는다. 답은 요청을 받은 순간의 서버 상태다 */
function holdMeetingList(workspaceId = 'ws_01') {
  const gate = deferred()
  server.use(
    http.get(`/api/v1/workspaces/${workspaceId}/meetings`, async ({ request }) => {
      const snapshot = await getResponse(handlers, request.clone())
      await gate.promise
      return snapshot
    }),
  )
  return gate
}

function headerLink(name: string) {
  return within(screen.getByRole('navigation', { name: '주요 화면' })).getByRole('link', { name })
}

/** 회의가 없는 두 번째 완료 공간 ws_04 (meetingProcessing.test.tsx 와 같은 모양) */
function addCompletedWorkspace() {
  db.workspaces.push({
    workspace_id: 'ws_04',
    name: '알고리즘 스터디',
    role: 'pm',
    created_at: '2026-09-04T00:00:00Z',
    onboarding: {
      completed: true,
      current_step: null,
      steps: ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'].map(
        (step) => ({ step, status: 'completed' }),
      ),
    },
  })
  db.accounts[0].workspaceIds.push('ws_04')
  db.integrations.ws_04 = {
    discord: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
    notion: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
  }
}

describe('기본 선택은 늦게 온 목록으로 사용자를 옮기지 않는다 (U5-1)', () => {
  it('목록을 기다리는 사이 메시지로 가는 중(화면 코드 대기)이면 회의록으로 끌고 오지 않는다', async () => {
    const list = holdMeetingList()
    const user = userEvent.setup()
    const app = renderApp(LIST_PATH)
    await screen.findByRole('heading', { level: 1, name: '회의록' })

    const paint = holdFirstPaints()
    await user.click(headerLink('메시지'))
    // 이동은 시작됐고 메시지 화면 코드를 기다린다 — 회의록 화면이 아직 그려져 있다
    expect(screen.getByRole('heading', { level: 1, name: '회의록' })).toBeInTheDocument()

    list.resolve()
    await settle()
    paint.release()
    expect(
      await screen.findByRole('heading', { name: '메시지는 준비 중이에요' }),
    ).toBeInTheDocument()
    await settle()

    expect(pathsOf(app).at(-1)).toBe(paths.messages('ws_01'))
    expect(pathsOf(app)).not.toContain(LATEST)
  })

  it('목록을 기다리는 사이 로그아웃하면 로그인 화면에 머물고 이전 세션의 회의록을 보이지 않는다', async () => {
    const list = holdMeetingList()
    const user = userEvent.setup()
    const app = renderApp(LIST_PATH)
    await screen.findByRole('heading', { level: 1, name: '회의록' })

    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    await screen.findByRole('heading', { name: '로그인' })
    list.resolve()
    await settle(200)

    await app.expectPath('/login')
    expect(pathsOf(app)).not.toContain(LATEST)
    expect(screen.queryByText('3주차 정기회의')).toBeNull()
  })

  it('목록을 기다리는 사이 다른 공간으로 옮기면 이전 공간의 회의록으로 돌아가지 않고 보이지도 않는다', async () => {
    addCompletedWorkspace()
    const list = holdMeetingList('ws_01')
    const app = renderApp(LIST_PATH)
    await screen.findByRole('heading', { level: 1, name: '회의록' })

    act(() => app.navigate(paths.meetings('ws_04')))
    expect(
      await screen.findByRole('heading', { level: 1, name: '아직 올린 회의가 없어요' }),
    ).toBeInTheDocument()
    list.resolve()
    await settle(200)

    expect(pathsOf(app).at(-1)).toBe(paths.meetings('ws_04'))
    expect(pathsOf(app)).not.toContain(LATEST)
    expect(screen.queryByText('3주차 정기회의')).toBeNull()
  })

  it('회의록을 보다가 다른 공간으로 옮기면 이전 공간의 회의록이 남지 않는다', async () => {
    addCompletedWorkspace()
    const app = renderApp(LATEST)
    await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })

    act(() => app.navigate(paths.meetings('ws_04')))
    expect(
      await screen.findByRole('heading', { level: 1, name: '아직 올린 회의가 없어요' }),
    ).toBeInTheDocument()
    await settle()
    expect(screen.queryByText('3주차 정기회의')).toBeNull()
    expect(screen.queryByRole('complementary', { name: '회의 목록' })).toBeNull()
  })
})
