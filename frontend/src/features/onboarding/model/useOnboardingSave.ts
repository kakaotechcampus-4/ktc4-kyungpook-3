import { useMutation, useQueryClient } from '@tanstack/react-query'
import { captureAccountIntro } from '@/entities/user'
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
 * 온보딩이 끝나면 돌아갈 공간 기억을 지우고, 이 계정이 다음 대시보드에서 매스 인트로를 보게 적는다 (#430).
 * 인트로 기록은 저장을 시작한 세션에 묶는다 — 응답 전에 로그아웃·계정 전환이 있으면 적지 않는다.
 * 실패는 `error` 로 남고 다시 부르면 남은 요청만 보낸다.
 */
export function useOnboardingSave(workspaceId: string): OnboardingSave {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (update: OnboardingUpdate) =>
      saveOnboardingProgress(queryClient, workspaceId, update),
    onMutate: () => ({ intro: captureAccountIntro(queryClient) }),
    onSuccess: (workspace, _update, context) => {
      if (!workspace.onboarding.completed) return
      clearReturnWorkspace()
      context.intro?.markPending()
    },
  })
  return {
    save: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}
