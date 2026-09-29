import { screen } from '@testing-library/react'
import { Suspense, isValidElement } from 'react'
import type { ReactElement, ReactNode, SuspenseProps } from 'react'
import { createRoutesFromElements } from 'react-router'
import type { RouteObject } from 'react-router'
import { db } from '@/shared/mock/db'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { renderApp } from '../test/renderApp'
import { RouteErrorBoundary } from './errors/RouteErrorBoundary'
import { appRoutes } from './routes'

/** 랜딩 캔버스의 h1 `한 번의 클릭으로,<br>매니저가 정리합니다` */
const LANDING_HEADING = /한 번의 클릭으로,\s*매니저가 정리합니다/

/* <Routes> 가 안에서 하는 변환과 같다. 경로 표를 요소 그대로 훑으려고 쓴다 */
const tree = createRoutesFromElements(appRoutes)

function allRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.flatMap((route) => [route, ...allRoutes(route.children ?? [])])
}

function leaves(routes: RouteObject[]): RouteObject[] {
  return allRoutes(routes).filter((route) => !route.children?.length)
}

/** 화면 칸의 element 는 RouteErrorBoundary 다. 그 안이 Suspense 면 지연 로드 화면이다 */
function lazyScreen(route: RouteObject): ReactElement<SuspenseProps> | null {
  const boundary = route.element
  if (!isValidElement<{ children: ReactNode }>(boundary) || boundary.type !== RouteErrorBoundary) {
    return null
  }
  const inner = boundary.props.children
  return isValidElement<SuspenseProps>(inner) && inner.type === Suspense ? inner : null
}

describe('경로 표', () => {
  it('loader 가 하나도 없다 — 가드를 우회하는 선조회가 없다', () => {
    for (const route of allRoutes(tree)) expect(route.loader).toBeUndefined()
  })

  it('모든 화면 칸은 페이지 element 를 Route Error Boundary 로 감싼다', () => {
    for (const route of leaves(tree)) {
      expect(isValidElement(route.element) && route.element.type === RouteErrorBoundary).toBe(true)
    }
  })

  it('주요 화면 13개는 지연 로드하고 Suspense 에 PageSkeleton 을 쓴다', () => {
    const lazyScreens = leaves(tree)
      .map(lazyScreen)
      .filter((element) => element !== null)
    expect(lazyScreens).toHaveLength(13)
    for (const { props } of lazyScreens) {
      expect(isValidElement(props.fallback) && props.fallback.type === PageSkeleton).toBe(true)
    }
  })
})

describe('등록 경로', () => {
  // 랜딩은 M4 에서 임시 제목 `랜딩` 대신 캔버스 제목을 쓴다. 로그인·회원가입은 폼 칸의 숨은 제목이 화면 이름이다
  it.each([
    ['/', LANDING_HEADING],
    ['/login', '로그인'],
    ['/signup', '회원가입'],
  ])('비로그인 %s → %s', async (path, heading) => {
    db.authenticated = false
    renderApp(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it.each([
    ['/workspaces', '워크스페이스 선택'],
    ['/onboarding/create_workspace', '워크스페이스 만들기'],
    ['/onboarding/ws_02/connect_notion', 'PM이 워크스페이스 설정을 마무리하고 있어요'],
    ['/workspaces/ws_01/dashboard', '대시보드'],
    ['/workspaces/ws_01/meetings', '회의'],
    ['/workspaces/ws_01/meetings/mt_09', '회의'],
    ['/workspaces/ws_01/tasks', '태스크'],
    ['/workspaces/ws_01/tasks/tk_01', '태스크'],
    ['/workspaces/ws_01/approvals/ap_01', '확인 필요'],
    ['/workspaces/ws_01/messages', '메시지는 준비 중이에요'],
    ['/workspaces/ws_01/members', '팀원'],
    ['/workspaces/ws_01/settings', '설정'],
  ])('로그인 %s → %s', async (path, heading) => {
    const app = renderApp(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    await app.expectPath(path)
  })

  // Vitest 는 MSW 모드가 아니다. 모의 OAuth 화면은 개발·MSW 모드에서만 등록된다 (mockOAuthRoute.test.tsx)
  it('MSW 모드가 아니면 모의 OAuth 화면이 없다', async () => {
    renderApp('/__mock/oauth/ws_01/discord?state=%2F')
    expect(
      await screen.findByRole('heading', { name: '페이지를 찾을 수 없어요' }),
    ).toBeInTheDocument()
    expect(allRoutes(tree).some(({ path }) => path?.startsWith('__mock'))).toBe(false)
  })

  it('M2 임시 갤러리는 없다', async () => {
    db.authenticated = false
    renderApp('/')
    await screen.findByRole('heading', { name: LANDING_HEADING })
    expect(screen.queryByText('M2 gallery')).toBeNull()
  })
})
