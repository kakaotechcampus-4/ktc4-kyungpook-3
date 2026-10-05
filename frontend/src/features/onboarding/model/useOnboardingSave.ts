import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OnboardingUpdate, Workspace } from '@/entities/workspace'
import { saveOnboardingProgress } from './progress'
import { clearReturnWorkspace } from '@/shared/lib/return-workspace'

export interface OnboardingSave {
  save: (update: OnboardingUpdate) => Promise<Workspace>
  isPending: boolean
  error: unknown
  reset: () => void
}

/**
 * 단계 저장. 성공하면 목록 캐시가 서버 상태로 바뀌고, 단계 가드(RequireValidOnboardingStep)가
 * 다음 미완료 단계나 대시보드로 옮긴다 — 화면이 직접 옮기지 않는다 (D-012, D-013).
 * 온보딩이 끝나면 돌아갈 공간 기억을 지운다. 실패는 `error` 로 남고 다시 부르면 남은 요청만 보낸다.
 */
export function useOnboardingSave(workspaceId: string): OnboardingSave {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (update: OnboardingUpdate) =>
      saveOnboardingProgress(queryClient, workspaceId, update),
    onSuccess: (workspace) => {
      if (workspace.onboarding.completed) clearReturnWorkspace()
    },
  })
  return {
    save: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}
