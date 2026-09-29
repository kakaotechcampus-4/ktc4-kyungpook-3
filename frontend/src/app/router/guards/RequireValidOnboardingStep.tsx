import { Navigate, Outlet, useParams, useSearchParams } from 'react-router'
import {
  isReviewableStep,
  onboardingResumePath,
  readOnboardingReview,
  readOnboardingStep,
  resumeStep,
  useMemberWorkspace,
  workspaceEntryPath,
} from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'

/**
 * 온보딩 단계 URL 을 서버의 저장 상태에 맞춘다 (D-012, D-013).
 * - 모르는 단계, 또는 이미 끝났거나 아직 아닌 단계 → 이어 갈 단계 (새로고침·재로그인·직접 URL 진입이 모두 같다)
 * - 둘러보기(`?review=1`)는 이어 갈 단계보다 앞의 저장된(완료·건너뜀) 단계만 보여 준다. 이어 갈 단계 자신이나
 *   그 밖의 둘러보기는 표시 없는 이어 갈 단계로 보낸다 (docs/impl-decision/2026-09-28-onboarding-layout.md, 2026-09-29)
 * - 온보딩을 마친 공간 → 대시보드. 단계를 저장하면 목록 캐시가 바뀌어 여기서 다음 화면으로 옮겨진다
 * 대시보드 쪽 완료 가드와 루프가 생기지 않는다 — 미완료면 여기 머물고 완료면 대시보드로만 간다.
 */
export function RequireValidOnboardingStep() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const step = readOnboardingStep(useParams().step)
  const [searchParams] = useSearchParams()

  if (workspace === null) return null
  if (workspace.onboarding.completed) {
    return <Navigate to={workspaceEntryPath(workspace)} replace />
  }
  if (step === null) return <Navigate to={onboardingResumePath(workspace)} replace />
  if (readOnboardingReview(searchParams)) {
    return isReviewableStep(workspace.onboarding, step) ? (
      <Outlet />
    ) : (
      <Navigate to={onboardingResumePath(workspace)} replace />
    )
  }
  if (step !== resumeStep(workspace.onboarding)) {
    return <Navigate to={onboardingResumePath(workspace)} replace />
  }
  return <Outlet />
}
