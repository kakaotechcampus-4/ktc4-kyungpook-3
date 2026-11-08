import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { SPLASH_INTERVAL_MS, SPLASH_RECORD_KEY, onSplashShow } from '@/shared/lib/splash'
import type { SplashShowKind } from '@/shared/lib/splash'
import { db } from '@/shared/mock/db'
import { renderApp } from './test/renderApp'

/* 다시 온 사람은 랜딩 대신 로그인, 랜딩 `시작하기` 스플래시 (#510). 스플래시 자체의 순서는 splash/SplashHost.test.tsx 가 본다 */

const LANDING_TITLE = /한 번의 클릭으로/

function recordShownAgo(ms: number) {
  window.localStorage.setItem(SPLASH_RECORD_KEY, String(Date.now() - ms))
}

/** 띄우기 신호를 받아 적는다. 스플래시가 없는 renderApp 에서 StartLink 가 무엇을 알렸는지 본다 */
function listenSplashShows() {
  const shows: SplashShowKind[] = []
  const stop = onSplashShow((_startedAt, kind) => {
    shows.push(kind)
  })
  onTestFinished(stop)
  return shows
}

beforeEach(() => {
  db.authenticated = false
})

describe('바깥에서 `/` 로 들어올 때', () => {
  it('스플래시 기록이 있으면(시각과 상관없이) 랜딩을 그리지 않고 로그인으로 바꿔 보낸다', async () => {
    recordShownAgo(30 * 24 * 60 * 60 * 1000)
    const app = renderApp('/')

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(screen.queryByRole('heading', { name: LANDING_TITLE })).toBeNull()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual(['/', '/login'])
    expect(app.visitedActions()).toEqual(['POP', 'REPLACE'])
  })

  it('기록이 없으면 랜딩이다 — 처음 온 사람과 검색 로봇', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: LANDING_TITLE })).toBeInTheDocument()
  })

  it('저장소를 읽지 못하면 처음 온 사람으로 보고 랜딩이다', async () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    onTestFinished(() => {
      blocked.mockRestore()
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: LANDING_TITLE })).toBeInTheDocument()
  })

  it('로그인한 사람은 기록이 있어도 지금처럼 워크스페이스로 간다', async () => {
    db.authenticated = true
    recordShownAgo(1000)
    const app = renderApp('/')
    await app.expectPath('/workspaces/ws_01/dashboard')
  })
})

describe('앱 안에서 `/` 로 갈 때', () => {
  it('기록이 있어도 로그인 화면 로고로 가면 랜딩이다 — 랜딩을 다시 볼 길', async () => {
    recordShownAgo(1000)
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })

    await userEvent.click(screen.getByRole('link', { name: "Manager's Manager" }))
    expect(await screen.findByRole('heading', { name: LANDING_TITLE })).toBeInTheDocument()
    await app.expectPath('/')
  })

  it('바깥에서 들어온 뒤 생긴 기록으로는 바꿔 보내지 않는다', async () => {
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })
    recordShownAgo(0)

    app.navigate('/')
    expect(await screen.findByRole('heading', { name: LANDING_TITLE })).toBeInTheDocument()
  })
})

describe('랜딩 `시작하기`', () => {
  const startLink = () => within(screen.getByRole('banner')).getByRole('link', { name: '시작하기' })

  it('전체 스플래시를 보일 차례면(기록 없음) 스플래시를 띄우며 로그인으로 간다', async () => {
    const shows = listenSplashShows()
    const app = renderApp('/')
    await screen.findByRole('heading', { name: LANDING_TITLE })

    await userEvent.click(startLink())
    expect(shows).toEqual(['start'])
    await app.expectPath('/login')
  })

  it('12시간이 지났으면 다시 띄운다', async () => {
    const shows = listenSplashShows()
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })
    recordShownAgo(SPLASH_INTERVAL_MS + 60 * 60 * 1000)
    app.navigate('/')
    await screen.findByRole('heading', { name: LANDING_TITLE })

    await userEvent.click(startLink())
    expect(shows).toEqual(['start'])
  })

  it('12시간 안이면 스플래시 없이 바로 로그인이다', async () => {
    const shows = listenSplashShows()
    const app = renderApp('/login')
    await screen.findByRole('heading', { name: '로그인' })
    recordShownAgo(11 * 60 * 60 * 1000)
    app.navigate('/')
    await screen.findByRole('heading', { name: LANDING_TITLE })

    await userEvent.click(startLink())
    await app.expectPath('/login')
    expect(shows).toEqual([])
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['가운데 버튼', { button: 1 }],
  ])(
    '%s 클릭(새 탭 열기)은 가로채지 않는다 — 스플래시도 앱 안 이동도 없다',
    async (_name, init) => {
      const shows = listenSplashShows()
      const app = renderApp('/')
      await screen.findByRole('heading', { name: LANDING_TITLE })
      // jsdom 은 링크의 기본 동작(새 탭)을 흉내 내지 못한다. 앱이 가로채지 않았는지만 본다
      let defaultPrevented: boolean | null = null
      const watch = (event: Event) => {
        defaultPrevented = event.defaultPrevented
        event.preventDefault()
      }
      document.addEventListener('click', watch)
      onTestFinished(() => {
        document.removeEventListener('click', watch)
      })

      fireEvent.click(startLink(), init)
      expect(defaultPrevented).toBe(false)
      expect(shows).toEqual([])
      await app.expectPath('/')
    },
  )
})
