import { act, render, screen, waitFor } from '@testing-library/react'
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
  await advance(2200)

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
  await advance(2200)
  expect(overlay()).toBeNull()
  expect(app.container).not.toHaveAttribute('inert')
})
