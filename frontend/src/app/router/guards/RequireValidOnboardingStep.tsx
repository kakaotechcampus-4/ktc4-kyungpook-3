import { Navigate, Outlet, useParams } from 'react-router'
import {
  onboardingResumePath,
  readOnboardingStep,
  resumeStep,
  useMemberWorkspace,
  workspaceEntryPath,
} from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'

/**
 * 온보딩 단계 URL 을 서버의 저장 상태에 맞춘다 (D-012, D-013).
 * - 모르는 단계, 또는 이미 끝났거나 아직 아닌 단계 → 이어 갈 단계 (새로고침·재로그인·직접 URL 진입이 모두 같다)
 * - 온보딩을 마친 공간 → 대시보드. 단계를 저장하면 목록 캐시가 바뀌어 여기서 다음 화면으로 옮겨진다
 * 대시보드 쪽 완료 가드와 루프가 생기지 않는다 — 미완료면 여기 머물고 완료면 대시보드로만 간다.
 */
export function RequireValidOnboardingStep() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const step = readOnboardingStep(useParams().step)

  if (workspace === null) return null
  if (workspace.onboarding.completed) {
    return <Navigate to={workspaceEntryPath(workspace)} replace />
  }
  if (step === null || step !== resumeStep(workspace.onboarding)) {
    return <Navigate to={onboardingResumePath(workspace)} replace />
  }
  return <Outlet />
}
