import type { QueryClient } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import type { OnboardingUpdateDto } from '@/shared/types/api/workspace'
import type { OnboardingUpdate, Workspace } from '../model/types'
import { upsertWorkspaceInList, workspaceDetailQueryOptions } from './workspaceDetail'

/** PM 만 된다. 실 API 는 빈 객체 `{}` 를 돌려준다 — 갱신된 상태는 상세로 다시 읽는다 (계약 §4.2) */
export async function updateOnboarding(
  workspaceId: string,
  update: OnboardingUpdate,
): Promise<void> {
  const body: OnboardingUpdateDto = { step: update.step, action: update.action }
  await request<Record<string, never>>(
    `/workspaces/${encodeURIComponent(workspaceId)}/onboarding`,
    { method: 'PATCH', body },
  )
}

/**
 * 온보딩 단계를 저장하는 공통 경로. **갱신 성공 → 상세 재조회 → 목록 캐시 반영** 순서를 지킨다.
 * 목록 캐시는 가드가 온보딩 완료를 판단하는 근거라, 상세를 받기 전에 추측으로 고치지 않는다.
 * 다음 화면 이동은 호출자가 돌려받은 공간으로 정한다. 어느 단계에서 실패해도 그대로 던진다.
 */
export async function saveOnboardingStep(
  queryClient: QueryClient,
  workspaceId: string,
  update: OnboardingUpdate,
): Promise<Workspace> {
  await updateOnboarding(workspaceId, update)
  const detail = workspaceDetailQueryOptions(workspaceId)
  // PATCH 전에 시작한 상세 요청이 진행 중이면 fetchQuery 가 그 요청에 합쳐져 PATCH 이전 값을 돌려준다.
  // 먼저 취소하고 새로 받는다. staleTime 0 — 캐시에 이전 상세가 있어도 반드시 다시 받는다
  await queryClient.cancelQueries({ queryKey: detail.queryKey })
  const workspace = await queryClient.fetchQuery({ ...detail, staleTime: 0 })
  upsertWorkspaceInList(queryClient, workspace)
  return workspace
}
