import { readFileSync } from 'node:fs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SPLASH_RECORD_KEY, showSplash, showStartSplash } from '@/shared/lib/splash'
import { RouteSkeleton } from '../router/RouteSkeleton'
import { SplashHost } from './SplashHost'

/* 로딩 스플래시의 끝내기 조건 (#430). 가짜 시계로 페이지 시작부터 ms 단위로 본다. 첫 화면 대기는 실제 RouteSkeleton 이 잡는다 */

const WORDMARK = "Manager's Manager"
const FRAME_MS = 10

interface Motion {
  reduced?: boolean
  standalone?: boolean
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
type MediaListener = (event: { matches: boolean }) => void

/** 돌려받은 setReduced 로 실행 중에 OS 의 움직임 줄이기 설정을 바꾼다 */
function stubMotion({ reduced = false, standalone = false }: Motion = {}) {
  let reducedNow = reduced
  const reducedListeners = new Set<MediaListener>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return (
        (query === REDUCED_MOTION && reducedNow) ||
        (query === '(display-mode: standalone)' && standalone)
      )
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: MediaListener) => {
      if (query === REDUCED_MOTION) reducedListeners.add(listener)
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      reducedListeners.delete(listener)
    },
    dispatchEvent: () => true,
  }))
  return {
    setReduced: (next: boolean) => {
      reducedNow = next
      act(() => {
        for (const listener of reducedListeners) listener({ matches: next })
      })
    },
  }
}

/* 라우트 뼈대는 캐시의 소속 목록으로 역할을 읽는다 (#510). 비어 있는 캐시면 된다 */
const queryClient = new QueryClient()

function Screen({ loading }: { loading: boolean }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{loading ? <RouteSkeleton /> : <h1>첫 화면</h1>}</MemoryRouter>
    </QueryClientProvider>
  )
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
/** index.html 의 스플래시 CSS 로 본 마스코트. jsdom 은 애니메이션을 돌리지 않아 등장 지연은 보지 못한다 */
const mascotShown = () => {
  const mascot = document.querySelector('.splash .splash__mascot')
  return mascot !== null && getComputedStyle(mascot).visibility !== 'hidden'
}

beforeAll(() => {
  const html = readFileSync(resolve(import.meta.dirname, '../../../index.html'), 'utf8')
  const style = document.createElement('style')
  style.textContent =
    new DOMParser().parseFromString(html, 'text/html').querySelector('style')?.textContent ?? ''
  document.head.append(style)
})

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
  document.documentElement.removeAttribute('data-splash')
})

/** 전체 스플래시를 마지막으로 보인 기록 (#510). 실제 시각(Date)이다 — 가짜 시계는 performance 만 돌린다 */
const record = () => window.localStorage.getItem(SPLASH_RECORD_KEY)

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
    // 눈웃음이 지어지는 0.5초와 다 지은 얼굴로 머무는 0.6초 동안 사라지지 않는다 (#506)
    for (let ms = 0; ms < 1000; ms += 100) {
      advance(100)
      expect(overlay()).not.toHaveAttribute('data-phase')
    }
    expect(smiling()).toBe(true)
    expect(appRoot).toHaveAttribute('inert')

    advance(100)
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

    for (let ms = 0; ms < 1100; ms += 100) {
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

  it('0.3초 직전에 준비되면 준비 확인이 0.3초를 넘겨도 마스코트를 보이지 않고 걷힌다', () => {
    stubMotion()
    const { appRoot, finishLoading } = boot()

    advance(250)
    finishLoading()
    advance(50)
    for (let ms = 300; ms < 350; ms += 10) {
      expect(mascotShown()).toBe(false)
      expect(status()).toBe('')
      advance(10)
    }
    expect(overlay()).toBeNull()
    expect(smiling()).toBe(false)
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('0.3초 직전에 뼈대가 비었다가 다시 잡히면 그때부터 보이고 눈웃음 → 사라짐으로 끝난다', () => {
    stubMotion()
    const { finishLoading } = boot()
    const nextSkeleton = render(<Screen loading={false} />)

    advance(250)
    finishLoading()
    advance(50)
    nextSkeleton.rerender(<Screen loading />)
    advance(10)
    expect(mascotShown()).toBe(true)

    advance(290)
    nextSkeleton.rerender(<Screen loading={false} />)
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(1100)
    expect(smiling()).toBe(true)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    advance(600)
    expect(overlay()).toBeNull()
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

  it('둘러보는 중에 켜면 정면으로 돌아와 기다리고, 준비되면 눈웃음 없이 바로 걷힌다', () => {
    const motion = stubMotion()
    const { appRoot, finishLoading } = boot()

    advance(1500)
    const front = leftEyeX()
    advance(1800)
    expect(leftEyeX()).not.toBe(front)

    motion.setReduced(true)
    advance(10)
    expect(leftEyeX()).toBe(front)
    advance(3000)
    expect(leftEyeX()).toBe(front)
    expect(status()).toBe('로그인 확인 중')

    finishLoading()
    expect(appRoot).not.toHaveAttribute('inert')
    advance(100)
    expect(overlay()).toBeNull()
    expect(smiling()).toBe(false)
  })

  it.each([
    ['눈웃음', 300],
    ['사라짐', 1300],
  ])('%s 중에 켜면 바로 걷힌다', (_phase, afterReady) => {
    const motion = stubMotion()
    const { appRoot, finishLoading } = boot()

    advance(2000)
    finishLoading()
    advance(100 + afterReady)
    expect(smiling()).toBe(true)

    motion.setReduced(true)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })
})

describe('설치한 앱', () => {
  it('시작 이미지에서 이어져 처음부터 보이므로, 빨리 준비돼도 눈웃음 뒤에 사라진다', () => {
    stubMotion({ standalone: true })
    const { finishLoading } = boot()

    finishLoading()
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(1100)
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
    advance(1700)
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

  it('0.3초 직전에 놓으면 준비 확인이 0.3초를 넘겨도 띄우지 않는다', () => {
    stubMotion()
    const appRoot = document.body.appendChild(document.createElement('div'))
    render(<Screen loading={false} />, { container: appRoot })
    render(<SplashHost appRoot={appRoot} />)

    let release = () => {}
    act(() => {
      release = showSplash()
    })
    advance(250)
    act(() => {
      release()
    })
    for (let ms = 250; ms < 3000; ms += 10) {
      advance(10)
      expect(overlay()).toBeNull()
      expect(appRoot).not.toHaveAttribute('inert')
    }
  })

  it('0.3초 직전에 놓았다가 도착 화면이 다시 잡으면 그때부터 덮고 눈웃음 → 사라짐으로 끝난다', () => {
    stubMotion()
    const appRoot = document.body.appendChild(document.createElement('div'))
    const app = render(<Screen loading={false} />, { container: appRoot })
    render(<SplashHost appRoot={appRoot} />)

    let release = () => {}
    act(() => {
      release = showSplash()
    })
    advance(250)
    act(() => {
      release()
    })
    advance(50)
    app.rerender(<Screen loading />)
    advance(10)
    expect(overlay()).toBeInTheDocument()
    expect(appRoot).toHaveAttribute('inert')

    advance(290)
    app.rerender(<Screen loading={false} />)
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(1100)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    advance(600)
    expect(overlay()).toBeNull()
  })
})

describe('12시간 안에 다시 옴 (#510)', () => {
  it('정적 판을 그리지 않았으면(skip) React 도 덮지 않는다 — 가드 대기는 뼈대가 보이고 준비되면 바로 화면이다', () => {
    stubMotion()
    document.documentElement.setAttribute('data-splash', 'skip')
    const { appRoot, staticSplash, finishLoading } = boot()

    expect(staticSplash).not.toBeInTheDocument()
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
    advance(2000)
    expect(overlay()).toBeNull()
    finishLoading()
    expect(screen.getByRole('heading', { name: '첫 화면' })).toBeInTheDocument()
    expect(record()).toBeNull()
  })

  it('설치한 앱(quick)은 정적 판을 이어받되, 준비되면 둘러보기·눈웃음 없이 0.2초에 사라진다', () => {
    stubMotion({ standalone: true })
    document.documentElement.setAttribute('data-splash', 'quick')
    const { appRoot, finishLoading } = boot()

    expect(overlay()).toBeInTheDocument()
    expect(appRoot).toHaveAttribute('inert')
    advance(3000)
    expect(status()).toBe('')
    expect(capPressed()).toBe(false)

    finishLoading()
    advance(100)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    expect(overlay()).toHaveAttribute('data-fade', 'quick')
    expect(smiling()).toBe(false)
    expect(appRoot).not.toHaveAttribute('inert')
    advance(199)
    expect(overlay()).toBeInTheDocument()
    advance(1)
    expect(overlay()).toBeNull()
    // 전체 스플래시가 아니라 기록하지 않는다 — 12시간이 지나면 다시 전체를 보인다
    expect(record()).toBeNull()
  })

  it('설치한 앱이 움직임 줄이기면 준비되는 순간 걷힌다', () => {
    stubMotion({ standalone: true, reduced: true })
    document.documentElement.setAttribute('data-splash', 'quick')
    const { finishLoading } = boot()

    finishLoading()
    advance(99)
    expect(overlay()).toBeInTheDocument()
    advance(1)
    expect(overlay()).toBeNull()
  })
})

describe('기록 시점 (#510)', () => {
  it('전체 스플래시가 보이면 그때 기록한다', () => {
    stubMotion()
    const before = Date.now()
    boot()

    advance(290)
    expect(record()).toBeNull()
    advance(10)
    expect(Number(record())).toBeGreaterThanOrEqual(before)
  })

  it('0.3초 안에 준비돼 보이지 않은 채 끝나면 기록하지 않는다', () => {
    stubMotion()
    const { finishLoading } = boot({ mountAt: 50 })

    finishLoading()
    advance(1000)
    expect(overlay()).toBeNull()
    expect(record()).toBeNull()
  })

  it('랜딩의 바로 걷힘은 전체 스플래시가 아니라 기록하지 않는다', () => {
    stubMotion()
    boot({ path: '/', mountAt: 500, loading: false })

    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    advance(600)
    expect(record()).toBeNull()
  })

  it('기록이 있는 사람이 12시간 뒤 `/` 로 오면 랜딩 바로 걷힘이 아니라 전체 스플래시다 — 로그인으로 가는 길이다', () => {
    stubMotion()
    window.localStorage.setItem(SPLASH_RECORD_KEY, '1')
    boot({ path: '/', mountAt: 500 })

    expect(overlay()).not.toHaveAttribute('data-phase')
    advance(1000)
    expect(status()).toBe('로그인 확인 중')
  })

  it('로그인 직후 스플래시는 보였을 때 기록하고, 0.3초 안에 끝나면 기록하지 않는다', () => {
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
    advance(2000)
    expect(record()).toBeNull()

    act(() => {
      release = showSplash()
    })
    advance(300)
    expect(record()).not.toBeNull()
    act(() => {
      release()
    })
  })
})

describe('랜딩 `시작하기` (#510)', () => {
  function mountForStart({ loading = false }: { loading?: boolean } = {}) {
    const appRoot = document.body.appendChild(document.createElement('div'))
    const app = render(<Screen loading={loading} />, { container: appRoot })
    render(<SplashHost appRoot={appRoot} />)
    act(() => {
      showStartSplash()
    })
    return {
      appRoot,
      startLoading: () => {
        app.rerender(<Screen loading />)
      },
      finishLoading: () => {
        app.rerender(<Screen loading={false} />)
      },
    }
  }

  it('한쪽 보기 중에 준비됐다가 다시 잡히면 미뤄 둔 준비를 버리고, 새로 풀린 뒤의 준비로 끝난다', () => {
    stubMotion()
    const { appRoot, startLoading, finishLoading } = mountForStart()

    // 0.1초에 준비 확인이 끝나 미뤄 둔다. 0.3초에 로그인 화면 뼈대가 다시 잡는다
    advance(300)
    startLoading()
    advance(500)
    // 한쪽 보기가 끝나도 눈웃음이 아니라 둘러보며 기다린다
    expect(status()).toBe('로그인 확인 중')
    expect(smiling()).toBe(false)
    advance(1000)
    expect(status()).toBe('로그인 확인 중')
    expect(appRoot).toHaveAttribute('inert')

    finishLoading()
    advance(90)
    expect(status()).toBe('로그인 확인 중')
    advance(10)
    expect(status()).toBe('준비됐어요')
    advance(1100)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    advance(600)
    expect(overlay()).toBeNull()
  })

  it('움직임 줄이기에서도 다시 잡히면 한쪽 보기 시간에 걷히지 않고, 새로 풀린 뒤의 준비에 걷힌다', () => {
    stubMotion({ reduced: true })
    const { appRoot, startLoading, finishLoading } = mountForStart()

    advance(300)
    startLoading()
    advance(500)
    expect(overlay()).toBeInTheDocument()
    advance(1000)
    expect(overlay()).toBeInTheDocument()
    expect(appRoot).toHaveAttribute('inert')

    finishLoading()
    advance(90)
    expect(overlay()).toBeInTheDocument()
    advance(10)
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('누른 순간 정면으로 보이고, 한쪽을 한 번 본 뒤 눈웃음 → 사라짐으로 약 2.5초에 끝난다', () => {
    stubMotion()
    const before = Date.now()
    const { appRoot } = mountForStart()

    // 등장 없이 정적 판과 같은 정면이다
    expect(overlay()).toBeInTheDocument()
    expect(overlay()).toHaveAttribute('data-instant')
    expect(shift()).toBe('0ms')
    expect(appRoot).toHaveAttribute('inert')
    expect(Number(record())).toBeGreaterThanOrEqual(before)
    const front = leftEyeX()
    expect(capPressed()).toBe(false)

    advance(90)
    expect(capPressed()).toBe(false)
    advance(110)
    expect(capPressed()).toBe(true)
    advance(590)
    expect(leftEyeX()).toBeLessThan(front - 10)
    expect(smiling()).toBe(false)
    expect(status()).toBe('')

    advance(10)
    expect(status()).toBe('준비됐어요')
    advance(1090)
    expect(overlay()).not.toHaveAttribute('data-phase')
    advance(10)
    expect(smiling()).toBe(true)
    expect(overlay()).toHaveAttribute('data-phase', 'leave')
    expect(appRoot).not.toHaveAttribute('inert')
    advance(590)
    expect(overlay()).toBeInTheDocument()
    advance(10)
    expect(overlay()).toBeNull()
  })

  it.each([
    ['누르기', () => fireEvent.pointerDown(document.body)],
    ['Enter', () => fireEvent.keyDown(document, { key: 'Enter' })],
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s 로 건너뛰면 바로 걷힌다', (_name, press) => {
    stubMotion()
    const { appRoot } = mountForStart()

    advance(400)
    act(() => {
      press()
    })
    expect(overlay()).toBeNull()
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('다른 키로는 건너뛰지 않는다', () => {
    stubMotion()
    mountForStart()

    advance(400)
    act(() => {
      fireEvent.keyDown(document, { key: 'Tab' })
    })
    expect(overlay()).toBeInTheDocument()
  })

  it('로그인 화면 코드가 늦으면 한쪽 보기 뒤 둘러보며 기다리고, 준비되면 눈웃음 → 사라짐이다', () => {
    stubMotion()
    const { finishLoading } = mountForStart({ loading: true })

    advance(1500)
    expect(status()).toBe('로그인 확인 중')
    finishLoading()
    advance(100)
    expect(status()).toBe('준비됐어요')
    advance(1700)
    expect(overlay()).toBeNull()
  })

  it('움직임 줄이기면 정면 그대로 한쪽 보기 시간(0.8초)만 머물고 눈웃음·사라짐 없이 걷힌다', () => {
    stubMotion({ reduced: true })
    mountForStart()
    const front = leftEyeX()

    advance(790)
    expect(overlay()).toBeInTheDocument()
    expect(leftEyeX()).toBe(front)
    advance(10)
    expect(overlay()).toBeNull()
    expect(smiling()).toBe(false)
  })

  it('랜딩의 사라짐이 남아 있어도 이어받는다', () => {
    stubMotion()
    boot({ path: '/', mountAt: 500, loading: false })
    expect(overlay()).toHaveAttribute('data-phase', 'leave')

    act(() => {
      showStartSplash()
    })
    expect(overlay()).not.toHaveAttribute('data-phase')
    expect(overlay()).toHaveAttribute('data-instant')
  })
})
