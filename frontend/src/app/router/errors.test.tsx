import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { createQueryClient } from '@/shared/api/queryClient'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { App } from '../App'
import { RootErrorBoundary } from './errors/RootErrorBoundary'
import { RouteErrorBoundary } from './errors/RouteErrorBoundary'

function Boom(): never {
  throw new Error('render exploded')
}

function Layout() {
  return (
    <div>
      <p>레이아웃 유지</p>
      <GuardedLink to="/fine">다른 화면으로</GuardedLink>
      <Outlet />
    </div>
  )
}

/** 제품과 같은 모양: 루트 경계가 라우터 트리를 감싸고, 화면 칸마다 Route 경계가 페이지를 감싼다 */
function renderTree(path: string, layout = <Layout />) {
  render(
    <RootErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={layout}>
            <Route
              path="/boom"
              element={
                <RouteErrorBoundary>
                  <Boom />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/fine"
              element={
                <RouteErrorBoundary>
                  <p>멀쩡한 화면</p>
                </RouteErrorBoundary>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </RootErrorBoundary>,
  )
}

describe('오류 경계', () => {
  beforeEach(() => {
    // React 가 잡은 오류를 콘솔에 다시 찍는다. 기대한 오류라 조용히 한다
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('화면의 렌더 오류는 Route Error Boundary 가 그 칸만 대신한다', async () => {
    renderTree('/boom')
    expect(
      await screen.findByRole('heading', { name: '이 화면을 표시하지 못했어요' }),
    ).toBeInTheDocument()
    expect(screen.getByText('레이아웃 유지')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '앱을 표시하지 못했어요' })).toBeNull()
    expect(screen.queryByText('render exploded')).toBeNull()
  })

  it('다른 화면으로 옮기면 Route Error Boundary 가 풀린다', async () => {
    const user = userEvent.setup()
    renderTree('/boom')
    await screen.findByRole('heading', { name: '이 화면을 표시하지 못했어요' })

    await user.click(screen.getByRole('link', { name: '다른 화면으로' }))
    expect(await screen.findByText('멀쩡한 화면')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '이 화면을 표시하지 못했어요' })).toBeNull()
  })

  it('레이아웃이 깨지면 Root Error Boundary 가 앱 전체를 대신한다', async () => {
    renderTree('/fine', <Boom />)
    expect(
      await screen.findByRole('heading', { name: '앱을 표시하지 못했어요' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('멀쩡한 화면')).toBeNull()
  })

  it('App 은 라우터 트리 전체를 Root Error Boundary 로 감싼다', async () => {
    const queryClient = createQueryClient()
    render(
      <App queryClient={queryClient}>
        <MemoryRouter>
          <Boom />
        </MemoryRouter>
      </App>,
    )
    expect(
      await screen.findByRole('heading', { name: '앱을 표시하지 못했어요' }),
    ).toBeInTheDocument()
    queryClient.clear()
  })
})
