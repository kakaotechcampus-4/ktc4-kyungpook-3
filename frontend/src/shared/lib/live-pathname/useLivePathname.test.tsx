import { act, render, screen } from '@testing-library/react'
import { Suspense, lazy, useLayoutEffect } from 'react'
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Router,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router'
import type { Navigator } from 'react-router'
import { deferred } from '@/shared/test/deferred'
import { useLivePathname } from './useLivePathname'

interface Seen {
  committed: string
  live: () => string
  navigate: (to: string) => void
}

/** 그릴 때마다 그려진 경로·지금 경로 읽기·이동 함수를 알린다 */
function Probe({ onRender }: { onRender: (seen: Seen) => void }) {
  const { pathname } = useLocation()
  const live = useLivePathname()
  const navigate = useNavigate()
  useLayoutEffect(() => {
    onRender({ committed: pathname, live, navigate: (to) => void navigate(to) })
  })
  return null
}

function watch() {
  let seen: Seen | null = null
  const get = (): Seen => {
    if (seen === null) throw new Error('probe has not rendered yet')
    return seen
  }
  return {
    onRender: (next: Seen) => {
      seen = next
    },
    get,
  }
}

describe('useLivePathname', () => {
  it('지연 로드 화면을 기다리는 이동 중에는 그려진 경로가 아니라 가는 경로를 준다', async () => {
    const code = deferred()
    const Later = lazy(async () => {
      await code.promise
      return { default: () => <h1>나중 화면</h1> }
    })
    const probe = watch()
    render(
      <MemoryRouter initialEntries={['/now']}>
        <Suspense fallback={<p>불러오는 중</p>}>
          <Routes>
            <Route path="now" element={<h1>지금 화면</h1>} />
            <Route path="later" element={<Later />} />
          </Routes>
        </Suspense>
        <Probe onRender={probe.onRender} />
      </MemoryRouter>,
    )
    expect(probe.get().live()).toBe('/now')

    act(() => probe.get().navigate('/later'))
    // 라우터는 이동을 transition 으로 그린다 — 코드가 오기 전까지 이전 화면과 이전 경로가 남는다
    expect(screen.getByRole('heading', { name: '지금 화면' })).toBeInTheDocument()
    expect(probe.get().committed).toBe('/now')
    expect(probe.get().live()).toBe('/later')

    act(() => code.resolve())
    expect(await screen.findByRole('heading', { name: '나중 화면' })).toBeInTheDocument()
    expect(probe.get().committed).toBe('/later')
    expect(probe.get().live()).toBe('/later')
  })

  // 앱(main.tsx)의 라우터다. jsdom 의 실제 기록(window.history) 위에서 같은 틈을 본다 — 기록 객체가 navigator 인지가 두 라우터에서 같은가
  it('BrowserRouter 에서도 지연 로드 화면을 기다리는 이동 중에는 가는 경로를 준다', async () => {
    const before = window.location.pathname
    window.history.replaceState(null, '', '/now')
    onTestFinished(() => window.history.replaceState(null, '', before))
    const code = deferred()
    const Later = lazy(async () => {
      await code.promise
      return { default: () => <h1>나중 화면</h1> }
    })
    const probe = watch()
    render(
      <BrowserRouter>
        <Suspense fallback={<p>불러오는 중</p>}>
          <Routes>
            <Route path="now" element={<h1>지금 화면</h1>} />
            <Route path="later" element={<Later />} />
          </Routes>
        </Suspense>
        <Probe onRender={probe.onRender} />
      </BrowserRouter>,
    )
    expect(probe.get().live()).toBe('/now')

    act(() => probe.get().navigate('/later'))
    expect(screen.getByRole('heading', { name: '지금 화면' })).toBeInTheDocument()
    expect(probe.get().committed).toBe('/now')
    expect(probe.get().live()).toBe('/later')

    act(() => code.resolve())
    expect(await screen.findByRole('heading', { name: '나중 화면' })).toBeInTheDocument()
    expect(probe.get().live()).toBe('/later')
  })

  it('지금 위치를 갖지 않는 navigator 면 그려진 경로로 물러난다', () => {
    const navigator: Navigator = {
      createHref: (to) => (typeof to === 'string' ? to : (to.pathname ?? '')),
      go: () => undefined,
      push: () => undefined,
      replace: () => undefined,
    }
    const probe = watch()
    render(
      <Router location="/here" navigator={navigator}>
        <Probe onRender={probe.onRender} />
      </Router>,
    )
    expect(probe.get().live()).toBe('/here')
  })
})
