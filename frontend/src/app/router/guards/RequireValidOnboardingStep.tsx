import { Navigate, Outlet, useParams } from 'react-router'
import { onboardingResumePath, readOnboardingStep, useMemberWorkspace } from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'

/**
 * 모르는 단계 URL 을 이어 갈 단계로 고친다. 완료 여부는 보지 않는다 — 여기에 완료 가드를 걸면
 * 미완료 공간이 대시보드와 온보딩 사이를 오가는 루프가 생긴다.
 */
export function RequireValidOnboardingStep() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const { step } = useParams()

  if (workspace === null) return null
  if (readOnboardingStep(step) === null) {
    return <Navigate to={onboardingResumePath(workspace)} replace />
  }
  return <Outlet />
}
