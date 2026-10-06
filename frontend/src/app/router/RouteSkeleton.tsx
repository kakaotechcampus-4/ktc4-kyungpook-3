import { matchPath, useLocation } from 'react-router'
import { parseRouteId } from '@/shared/lib/url'
import { MinutesPageSkeleton, OnboardingSkeleton, PageSkeleton } from '@/shared/ui/page-skeleton'
import { WorkspaceShellSkeleton } from './layouts/WorkspaceLayout'

/** 회의록 화면 경로(routes.tsx 의 `meetings/:meetingId?`). `meetings/upload` 는 정적 경로가 먼저라 회의록이 아니다 */
function isMinutesPath(pathname: string): boolean {
  const match = matchPath('/workspaces/:workspaceId/meetings/:meetingId?', pathname)
  return match !== null && match.params.meetingId !== 'upload'
}

/**
 * 화면 코드·가드 캐시를 기다리는 동안의 자리. 온보딩은 가운데 열 틀이라 그 모양의 뼈대를 쓴다 —
 * 제품 화면 뼈대(왼쪽 위)를 쓰면 온보딩이 그려질 때 내용이 크게 튄다. 회의록은 같은 이유로 왼쪽 목록 + 오른쪽 본문 2단 뼈대다.
 */
export function RouteSkeleton() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/onboarding/')) return <OnboardingSkeleton />
  if (isMinutesPath(pathname)) return <MinutesPageSkeleton />
  return <PageSkeleton />
}

/**
 * 앱 셸(WorkspaceLayout) 안에 그려질 경로 — `/workspaces/:workspaceId/...`. 공간 선택(`/workspaces`)은 셸이 없다.
 * ID 모양이 틀리면 소속 가드가 셸 없는 404 를 그리므로 셸 자리를 두지 않는다
 */
function isWorkspaceShellPath(pathname: string): boolean {
  const match = matchPath('/workspaces/:workspaceId/*', pathname)
  return match !== null && parseRouteId(match.params.workspaceId) !== null
}

/**
 * 가드가 세션·소속 캐시를 기다리는 동안의 자리. 가드는 앱 셸 바깥 칸이라 셸 안 경로에서는 셸 틀과 헤더 뼈대를 함께 그린다 —
 * 그래야 셸이 뜰 때 화면 뼈대가 헤더 높이만큼 내려가지 않는다 (UX1-M01). 인증·온보딩·공간 선택처럼 헤더가 없는 경로는 RouteSkeleton 그대로다.
 * 화면 코드 대기(lazyPage 의 Suspense)는 이미 셸 안이라 RouteSkeleton 만 쓴다.
 */
export function GuardSkeleton() {
  const { pathname } = useLocation()
  if (!isWorkspaceShellPath(pathname)) return <RouteSkeleton />
  return (
    <WorkspaceShellSkeleton>
      <RouteSkeleton />
    </WorkspaceShellSkeleton>
  )
}
