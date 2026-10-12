import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router'
import { sessionQueryOptions } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { GuardSkeleton } from '../RouteSkeleton'
import { ScreenError } from './ScreenError'

/**
 * 로그인해야 들어오는 경로의 바깥 칸. 부팅이 시작한 /auth/me 캐시를 구독만 한다.
 * 세션 조회 자체가 실패하면(네트워크 등) 로그인으로 보내지 않는다 — 로그아웃이 아니다.
 * 이미 받은 세션이 있으면 백그라운드 재조회가 실패해도 그대로 둔다.
 */
export function RequireAuth() {
  const session = useQuery(sessionQueryOptions())

  if (session.data === undefined) {
    return session.isError ? (
      <ScreenError error={session.error} onRetry={() => void session.refetch()} />
    ) : (
      <GuardSkeleton />
    )
  }
  if (session.data === null) return <Navigate to={paths.login()} replace />
  return <Outlet />
}
