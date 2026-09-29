import { useCallback } from 'react'
import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'

/**
 * `새 워크스페이스 만들기` (D-068). 지금 보던 공간 ID 를 기억하고 생성 온보딩으로 간다.
 * 기억한 공간은 온보딩 뒤로가기(D-069)의 목적지다. 공간 밖(선택 화면)에서 시작하면 null 을 넘긴다.
 * 이동은 관문을 탄다 — 저장하지 않은 변경이 있으면 먼저 묻는다.
 */
export function useStartNewWorkspace(): (fromWorkspaceId: string | null) => void {
  const navigate = useGuardedNavigate()
  return useCallback(
    (fromWorkspaceId) => {
      // 관문이 이동을 붙잡아도(이탈 확인) 기억은 남는다 — 다음 새 공간 만들기가 덮어쓴다
      rememberReturnWorkspace(fromWorkspaceId)
      navigate(paths.onboardingCreate())
    },
    [navigate],
  )
}
