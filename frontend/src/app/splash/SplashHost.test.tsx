import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { showSplash } from '@/shared/lib/splash'
import { RouteSkeleton } from '../router/RouteSkeleton'
import { SplashHost } from './SplashHost'

/* 로딩 스플래시의 끝내기 조건 (#430). 가짜 시계로 페이지 시작부터 ms 단위로 본다. 첫 화면 대기는 실제 RouteSkeleton 이 잡는다 */

const WORDMARK = "Manager's Manager"
const FRAME_MS = 10

interface Motion {
  reduced?: boolean
  standalone?: boolean
}

function stubMotion({ reduced = false, standalone = false }: Motion = {}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      (query === '(prefers-reduced-motion: reduce)' && reduced) ||
      (query === '(display-mode: standalone)' && standalone),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }))
}

function Screen({ loading }: { loading: boolean }) {
  return <MemoryRouter>{loading ? <RouteSkeleton /> : <h1>첫 화면</h1>}</MemoryRouter>
}

interface BootOptions {
  path?: string
  /** React 가 뜨기까지 걸린 시간 */
  mountAt?: number
  loading?: boolean
}

/** index.html 의 정적 스플래시가 있는 새로 접속. 앱과 스플래시를 main.tsx 처럼 나란히 띄운다 */
function boot({
  path = '/workspaces/ws_01/dashboard',
  mountAt = 0,
  loading = true,
}: BootOptions = {}) {
  window.history.replaceState(null, '', path)
  const staticSplash = document.createElement('div')
  staticSplash.id = 'boot-splash'
  document.body.append(staticSplash)
  advance(mountAt)
  const appRoot = document.body.appendChild(document.createElement('div'))
  const app = render(<Screen loading={loading} />, { container: appRoot })
  render(<SplashHost appRoot={appRoot} />)
  return {
    appRoot,
    staticSplash,
    finishLoading: () => {
      app.rerender(<Screen loading={false} />)
    },
  }
}

/** 한 act 안에서는 렌더가 끝에 한 번이라, 그 사이에 건 다음 타이머가 늦게 걸린다. 브라우저처럼 프레임마다 렌더한다 */
function advance(ms: number) {
  for (let left = ms; left > 0; left -= FRAME_MS) {
    act(() => {
      vi.advanceTimersByTime(Math.min(left, FRAME_MS))
    })
  }
}

const overlay = () => screen.queryByText(WORDMARK)?.closest('.splash') ?? null
const status = () => screen.queryByRole('status')?.textContent ?? null
const smiling = () => document.querySelector('[data-part="smile-l"]') !== null
const capPressed = () =>
  document.querySelector('[data-part="cap-g"]')?.getAttribute('transform')?.includes('scale') ??
  false
const shift = () => (overlay() as HTMLElement | null)?.style.getPropertyValue('--splash-shift')
const leftEyeX = () => Number(document.querySelector('[data-part="eye-l"]')?.getAttribute('x'))

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  })
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('새로 접속', () => {
  it('늦게 준비되면 모자를 누르고 둘러보다가, 준비되면 눈웃음 → 사라짐 → 걷힘이다', () => {
    stubMotion()
    const { appRoot, staticSplash, finishLoading } = boot()

    // React 판이 정적 판을 같은 커밋에 이어받는다
    expect(staticSplash).not.toBeInTheDocument()
    expect(overlay()).toBeInTheDocument()
    expect(appRoot).toHaveAttribute('inert')

    advance(1400)
    expect(capPressed()).toBe(false)
    advance(100)
    expect(status()).toBe('로그인 확인 중')
    const front = leftEyeX()
    advance(100)
    expect(capPressed()).toBe(true)

    advance(2600)
    expect(leftEyeX()).toBeLessThan(front - 20)

    advance(2000)
    expect(status()).toBe('로그인 확인 중')
    expect(smiling()).toBe(false)

    finishLoading()
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(500)
    expect(smiling()).toBe(true)
    expect(overlay()).not.toHaveAttribute('data-phase')
    expect(appRoot).toHaveAttribute('inert')

    advance(1100)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    expect(appRoot).not.toHaveAttribute('inert')
    expect(screen.getByRole('heading', { name: '첫 화면' })).toBeInTheDocument()

    advance(599)
    expect(overlay()).toBeInTheDocument()
    advance(1)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('둘러보기 전에 준비되면 둘러보기 없이 바로 눈웃음 → 사라짐이다', () => {
    stubMotion()
    const { appRoot, finishLoading } = boot()
    const seen: Array<string | null> = []

    advance(400)
    finishLoading()
    for (let ms = 0; ms < 100; ms += 10) {
      advance(10)
      seen.push(status())
    }
    expect(status()).toBe('준비됐어요')

    for (let ms = 0; ms < 1600; ms += 100) {
      advance(100)
      seen.push(status())
    }
    expect(seen).not.toContain('로그인 확인 중')
    expect(smiling()).toBe(true)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')

    advance(600)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('0.3초 안에 준비되면 보이기 전에 걷힌다 — 눈웃음도 사라짐도 없다', () => {
    stubMotion()
    const { appRoot, finishLoading } = boot({ mountAt: 50 })

    advance(50)
    finishLoading()
    advance(99)
    expect(overlay()).toBeInTheDocument()
    expect(overlay()).not.toHaveAttribute('data-phase')
    advance(1)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
    expect(smiling()).toBe(false)
  })

  it('React 가 늦게 떠도 등장은 처음부터 다시 돌지 않는다 — 지난 시간만큼 CSS 등장을 앞당긴다', () => {
    stubMotion()
    boot({ mountAt: 900 })

    expect(shift()).toBe('900ms')
    advance(600)
    expect(status()).toBe('로그인 확인 중')
  })

  it('대시보드 카드처럼 라우트 뼈대가 아닌 로딩은 기다리지 않는다', () => {
    stubMotion()
    const { finishLoading } = boot()

    advance(2000)
    // 화면은 그려졌고 카드 뼈대만 남은 상태 — 라우트 뼈대가 없으면 첫 화면이다
    finishLoading()
    advance(100)
    expect(status()).toBe('준비됐어요')
  })

  it('가드 → 이동 → 화면 코드 사이에 뼈대가 잠깐 비어도 끝내지 않는다', () => {
    stubMotion()
    const { finishLoading } = boot()
    const nextSkeleton = render(<Screen loading={false} />)

    advance(2000)
    finishLoading()
    advance(60)
    nextSkeleton.rerender(<Screen loading />)
    advance(1000)
    expect(status()).toBe('로그인 확인 중')

    nextSkeleton.rerender(<Screen loading={false} />)
    advance(100)
    expect(status()).toBe('준비됐어요')
  })
})

describe('움직임 줄이기', () => {
  it('정면 그대로 기다리고, 준비되면 눈웃음·사라짐 없이 바로 걷힌다', () => {
    stubMotion({ reduced: true })
    const { appRoot, finishLoading } = boot()

    advance(1500)
    expect(status()).toBe('로그인 확인 중')
    const front = leftEyeX()
    advance(3400)
    expect(leftEyeX()).toBe(front)

    finishLoading()
    // 첫 화면이 그려진 순간부터는 앱을 막지 않는다. 덮개는 준비 확인(0.1초) 뒤 걷힌다
    expect(appRoot).not.toHaveAttribute('inert')
    advance(99)
    expect(overlay()).toBeInTheDocument()
    advance(1)
    expect(overlay()).toBeNull()
    expect(smiling()).toBe(false)
  })
})

describe('설치한 앱', () => {
  it('시작 이미지에서 이어져 처음부터 보이므로, 빨리 준비돼도 눈웃음 뒤에 사라진다', () => {
    stubMotion({ standalone: true })
    const { finishLoading } = boot()

    finishLoading()
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(1600)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    advance(600)
    expect(overlay()).toBeNull()
  })
})

describe('랜딩', () => {
  it('React 가 뜨면 둘러보기·눈웃음 없이 바로 사라진다. 랜딩은 그 아래 그려져 있다', () => {
    stubMotion()
    const { appRoot } = boot({ path: '/', mountAt: 500, loading: false })

    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    expect(appRoot).not.toHaveAttribute('inert')
    expect(screen.getByRole('heading', { name: '첫 화면' })).toBeInTheDocument()
    expect(status()).toBe('')
    advance(600)
    expect(overlay()).toBeNull()
    expect(smiling()).toBe(false)
  })

  it('0.3초 안에 뜨면 사라짐도 없이 바로 걷힌다', () => {
    stubMotion()
    boot({ path: '/', mountAt: 100, loading: false })

    expect(overlay()).toBeNull()
  })
})

describe('로그인 직후', () => {
  it('띄우기 신호를 받으면 0.3초 뒤부터 덮고, 놓고 도착 화면 뼈대가 사라지면 걷힌다', () => {
    stubMotion()
    const appRoot = document.body.appendChild(document.createElement('div'))
    const app = render(<Screen loading={false} />, { container: appRoot })
    render(<SplashHost appRoot={appRoot} />)
    expect(overlay()).toBeNull()

    let release = () => {}
    act(() => {
      release = showSplash()
    })
    advance(299)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
    advance(1)
    expect(shift()).toBe('300ms')
    expect(appRoot).toHaveAttribute('inert')

    act(() => {
      release()
    })
    app.rerender(<Screen loading />)
    advance(2000)
    expect(status()).toBe('로그인 확인 중')

    app.rerender(<Screen loading={false} />)
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(2200)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('0.3초 안에 끝나면 띄우지 않는다', () => {
    stubMotion()
    const appRoot = document.body.appendChild(document.createElement('div'))
    render(<Screen loading={false} />, { container: appRoot })
    render(<SplashHost appRoot={appRoot} />)

    let release = () => {}
    act(() => {
      release = showSplash()
    })
    advance(150)
    act(() => {
      release()
    })
    for (let ms = 0; ms < 3000; ms += 50) {
      advance(50)
      expect(overlay()).toBeNull()
    }
  })
})
