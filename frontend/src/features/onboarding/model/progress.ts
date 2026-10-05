import type { QueryClient } from '@tanstack/react-query'
import {
  saveOnboardingStep,
  updateOnboarding,
  upsertWorkspaceInList,
  workspaceDetailQueryOptions,
} from '@/entities/workspace'
import type { OnboardingStep, OnboardingUpdate, Workspace } from '@/entities/workspace'

function statusOf(workspace: Workspace, step: OnboardingStep) {
  return workspace.onboarding.steps.find((item) => item.step === step)?.status ?? 'pending'
}

/**
 * 한 번의 사용자 행동이 저장할 단계들. 이미 저장된(pending 이 아닌) 단계는 뺀다 — 재시도가 남은 것만 보낸다.
 *
 * Discord 를 건너뛰어도 팀원 연결은 건드리지 않는다. D-073 의 연쇄(Discord 건너뜀 ⇒ 팀원 건너뜀)는
 * 2026-09-29 사용자 결정으로 없앴다 — Notion 뒤에는 언제나 팀원 연결 단계가 온다. 이미 건너뜀으로 저장된 팀원 단계는 그대로 둔다.
 */
export function planOnboardingUpdates(
  workspace: Workspace,
  update: OnboardingUpdate,
): OnboardingUpdate[] {
  return statusOf(workspace, update.step) === 'pending' ? [update] : []
}

/**
 * 온보딩 단계 저장. 먼저 서버의 지금 상태를 새로 읽고(진행 중 상세 요청은 취소) 남은 단계만 순서대로 보낸다.
 * 지금은 한 행동이 한 단계뿐이지만(D-073 개정) 여러 단계를 보내는 경로는 그대로 둔다.
 * 마지막 단계는 공통 경로(`saveOnboardingStep`: PATCH → 상세 재조회 → 목록 캐시)로 저장한다.
 * 앞 단계들은 목록 캐시를 건드리지 않는다 — 목록이 중간 상태로 바뀌면 단계 가드가 화면을 먼저 옮겨
 * 남은 요청의 실패를 보일 곳이 없어진다. 실패하면 그대로 던지고, 다시 부르면 저장된 상태를 다시 읽는다.
 */
export async function saveOnboardingProgress(
  queryClient: QueryClient,
  workspaceId: string,
  update: OnboardingUpdate,
): Promise<Workspace> {
  const detail = workspaceDetailQueryOptions(workspaceId)
  await queryClient.cancelQueries({ queryKey: detail.queryKey })
  const current = await queryClient.fetchQuery({ ...detail, staleTime: 0 })
  const pending = planOnboardingUpdates(current, update)
  const last = pending.at(-1)
  if (last === undefined) {
    // 이미 다 저장돼 있다. 목록만 서버 상태에 맞춘다
    upsertWorkspaceInList(queryClient, current)
    return current
  }
  for (const step of pending.slice(0, -1)) await updateOnboarding(workspaceId, step)
  return saveOnboardingStep(queryClient, workspaceId, last)
}
