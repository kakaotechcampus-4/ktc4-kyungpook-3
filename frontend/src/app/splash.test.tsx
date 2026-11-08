import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { SplashHost } from './splash/SplashHost'
import { renderApp } from './test/renderApp'

/* 로딩 스플래시 (#430) 를 제품과 같은 배선(renderApp + MSW)에 main.tsx 처럼 나란히 띄운다. 끝내기 조건의 경계는 splash/SplashHost.test.tsx 가 본다 */

// 로그인 화면에도 서비스 이름이 있어 덮개는 클래스로 찾는다
const overlay = () => document.querySelector('.splash')
const status = () => overlay()?.querySelector('[role="status"]')?.textContent ?? null

async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 20) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(left, 20))
    })
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
    shouldAdvanceTime: true,
  })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }))
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

it('새로 접속: 로그인 확인을 덮고, 대시보드가 그려지면 카드 데이터를 기다리지 않고 걷힌다', async () => {
  const session = deferred()
  const tasks = deferred()
  server.use(
    http.get('/api/v1/auth/me', async () => {
      await session.promise
      return ok(db.session)
    }),
    // 기다린 뒤 아무것도 돌려주지 않으면 원래 handler 가 답한다
    http.get('/api/v1/tasks', async () => {
      await tasks.promise
    }),
  )
  const log = recordRequests()
  const path = '/workspaces/ws_01/dashboard'
  window.history.replaceState(null, '', path)
  const staticSplash = document.body.appendChild(document.createElement('div'))
  staticSplash.id = 'boot-splash'
  const app = renderApp(path)
  render(<SplashHost appRoot={app.container} />)

  await advance(2000)
  expect(status()).toBe('로그인 확인 중')
  expect(app.container).toHaveAttribute('inert')

  session.resolve()
  expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
  await waitFor(() => expect(status()).toBe('준비됐어요'))
  await advance(1700)

  expect(overlay()).toBeNull()
  expect(app.container).not.toHaveAttribute('inert')
  expect(log.started.map(({ path }) => path)).toContain('/tasks?workspace_id=ws_01')
  expect(log.answered.map(({ path }) => path)).not.toContain('/tasks?workspace_id=ws_01')
  tasks.resolve()
})

it('로그인 직후: 공간 확인부터 덮고, 도착 화면이 그려지면 걷힌다', async () => {
  db.authenticated = false
  const app = renderApp('/login')
  render(<SplashHost appRoot={app.container} />)
  await screen.findByRole('heading', { name: '로그인' })
  expect(overlay()).toBeNull()

  const workspaces = deferred()
  server.use(
    http.get('/api/v1/workspaces', async () => {
      await workspaces.promise
    }),
  )
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  await user.type(screen.getByLabelText('이메일'), 'pm@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'mock-password')
  await user.click(screen.getByRole('button', { name: '로그인' }))

  await waitFor(() => expect(overlay()).not.toBeNull())
  expect(app.container).toHaveAttribute('inert')
  await advance(1600)
  expect(status()).toBe('로그인 확인 중')

  workspaces.resolve()
  expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  await waitFor(() => expect(status()).toBe('준비됐어요'))
  await advance(1700)
  expect(overlay()).toBeNull()
  expect(app.container).not.toHaveAttribute('inert')
})

/** 로그인 폼의 숨은 제목 — 인증 틀이 표시한 화면 시작점이다. 입력에 두면 다른 곳을 누를 때 빈 칸 검증이 떠 링크가 밀린다 */
const formStart = () => screen.getByRole('heading', { level: 2, name: '로그인' })

// 2.5초를 20ms 씩 렌더하며 넘긴다. 앱 전체를 띄우는 흐름이라 기본 5초 한도가 빠듯하다

describe('랜딩 `시작하기` 스플래시의 포커스와 안내 (#510)', { timeout: 15_000 }, () => {
  const HINT = '로그인 화면을 준비하고 있어요. Enter 나 Esc 를 누르면 건너뛰어요.'

  async function pressStartWithEnter() {
    db.authenticated = false
    const app = renderApp('/')
    render(<SplashHost appRoot={app.container} />)
    const link = within(await screen.findByRole('banner')).getByRole('link', { name: '시작하기' })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    link.focus()
    await user.keyboard('{Enter}')
    return { app, user }
  }

  it('링크를 Enter 로 누르면 판이 포커스를 받아 건너뛰는 법을 알리고, 걷히기 시작하면 로그인 폼 제목으로 포커스가 간다', async () => {
    const { app } = await pressStartWithEnter()

    const dialog = screen.getByRole('dialog', { name: "Manager's Manager" })
    expect(dialog).toHaveFocus()
    expect(dialog).toHaveAccessibleDescription(HINT)
    expect(app.container).toHaveAttribute('inert')
    await app.expectPath('/login')

    // 0.8초 한쪽 보기 + 1.1초 눈웃음 동안 포커스는 판에 있다. 실제 시간도 흘러 사라짐 시작(1.9초)보다 넉넉히 앞에서 본다
    await advance(1200)
    expect(dialog).toHaveFocus()
    expect(app.container).toHaveAttribute('inert')

    // 사라짐(0.6초)이 시작되는 순간 앱을 풀고 포커스를 넘긴다. 실제 시간도 흐르므로 사라짐 도중인지 끝났는지는 보지 않는다
    await advance(700)
    await waitFor(() => expect(app.container).not.toHaveAttribute('inert'))
    expect(formStart()).toHaveFocus()

    await advance(600)
    expect(overlay()).toBeNull()
    expect(formStart()).toHaveFocus()
  })

  it.each(['{Enter}', '{Escape}'])(
    '%s 로 건너뛰면 바로 걷히고 로그인 폼 제목으로 포커스가 간다',
    async (key) => {
      const { app, user } = await pressStartWithEnter()
      expect(screen.getByRole('dialog', { name: "Manager's Manager" })).toHaveFocus()

      await advance(300)
      await user.keyboard(key)
      expect(overlay()).toBeNull()
      expect(app.container).not.toHaveAttribute('inert')
      await waitFor(() => expect(formStart()).toHaveFocus())
    },
  )
})
