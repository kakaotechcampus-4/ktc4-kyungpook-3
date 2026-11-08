import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router'
import { sessionQueryOptions } from '@/entities/user'
import { wasSignedOutAt } from '@/features/auth'
import { paths } from '@/shared/config/routes'
import { GuardSkeleton } from '../RouteSkeleton'
import { ScreenError } from './ScreenError'

/**
 * 로그인해야 들어오는 경로의 바깥 칸. 부팅이 시작한 /auth/me 캐시를 구독만 한다.
 * 세션 조회 자체가 실패하면(네트워크 등) 로그인으로 보내지 않는다 — 로그아웃이 아니다.
 * 이미 받은 세션이 있으면 백그라운드 재조회가 실패해도 그대로 둔다.
 *
 * 비로그인이면 지금 주소를 `next` 로 붙여 로그인으로 보낸다 — 로그인 뒤 RedirectIfAuthed 가 그곳으로 돌려보낸다 (#411).
 * 푸시로 연 대화·태스크, 세션 만료로 떨어진 화면이 그렇다. 직접 로그아웃한 항목에는 붙이지 않는다.
 * 값은 받는 쪽이 다시 확인하므로 여기서는 거르지 않는다.
 */
export function RequireAuth() {
  const session = useQuery(sessionQueryOptions())
  const location = useLocation()

  if (session.data === undefined) {
    return session.isError ? (
      <ScreenError error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <GuardSkeleton />
    )
  }
  if (session.data === null) {
    const returnPath = wasSignedOutAt(location.key)
      ? undefined
      : location.pathname + location.search + location.hash
    return <Navigate to={paths.login(returnPath)} replace />
  }
  return <Outlet />
}
