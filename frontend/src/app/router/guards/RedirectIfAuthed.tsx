import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router'
import { sessionQueryOptions } from '@/entities/user'
import { authRevisitPath, workspaceListQueryOptions } from '@/entities/workspace'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { ScreenError } from './ScreenError'

/**
 * 랜딩·로그인·회원가입의 바깥 칸. 로그인한 사용자는 마지막 공간 또는 개수 분기로 보낸다 (D-131).
 * 비로그인이거나 세션 조회가 실패했으면 공개 화면을 그대로 보여 준다.
 * 목록 조회는 로그인했을 때만 구독한다 — 비로그인에게 401 을 한 번 더 만들지 않는다.
 */
export function RedirectIfAuthed() {
  const session = useQuery(sessionQueryOptions())
  const workspaces = useQuery({ ...workspaceListQueryOptions(), enabled: Boolean(session.data) })

  if (session.data === undefined && session.isPending) return <PageSkeleton />
  if (!session.data) return <Outlet />
  if (workspaces.data === undefined) {
    return workspaces.isError ? (
      <ScreenError error={workspaces.error} onRetry={() => void workspaces.refetch()} />
    ) : (
      <PageSkeleton />
    )
  }
  return <Navigate to={authRevisitPath(workspaces.data, session.data.lastWorkspaceId)} replace />
}
