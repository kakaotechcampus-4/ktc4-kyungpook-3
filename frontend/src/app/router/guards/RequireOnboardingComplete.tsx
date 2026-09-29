import { Navigate, Outlet } from 'react-router'
import { onboardingResumePath, useMemberWorkspace } from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'

/**
 * 미완료 공간의 서비스 화면은 서버의 현재 온보딩 단계로 보낸다 (D-071).
 * 서버가 403 ONBOARDING_INCOMPLETE 를 던지지 않으므로 목록의 onboarding.completed 로 판단한다 (D-172).
 */
export function RequireOnboardingComplete() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))

  // RequireTeamMember 안쪽이라 null 이 오지 않는다. 오면 아무것도 그리지 않는다
  if (workspace === null) return null
  if (!workspace.onboarding.completed) {
    return <Navigate to={onboardingResumePath(workspace)} replace />
  }
  return <Outlet />
}
