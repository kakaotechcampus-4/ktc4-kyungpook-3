import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { findMemberWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import { NoAccessPage } from '@/pages/no-access'
import { NotFoundPage } from '@/pages/not-found'
import { useRouteId } from '@/shared/lib/url'
import { RouteSkeleton } from '../RouteSkeleton'
import { ScreenError } from './ScreenError'

/**
 * URL 의 워크스페이스가 소속 목록에 있는지 본다. 상세(`GET /workspaces/{id}`)는 부르지 않는다.
 * ID 모양이 틀리면 404, 목록에 없으면 접근 불가 화면이다 (D-131). 둘 다 업무 API 를 부르지 않는다.
 */
export function RequireTeamMember() {
  const workspaceId = useRouteId('workspaceId')
  const workspaces = useQuery(workspaceListQueryOptions())

  if (workspaceId === null) return <NotFoundPage />
  if (workspaces.data === undefined) {
    return workspaces.isError ? (
      <ScreenError error={workspaces.error} onRetry={() => void workspaces.refetch()} />
    ) : (
      <RouteSkeleton />
    )
  }
  if (findMemberWorkspace(workspaces.data, workspaceId) === null) return <NoAccessPage />
  return <Outlet />
}
