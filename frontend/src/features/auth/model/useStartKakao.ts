import { useCallback } from 'react'
import { kakaoStartUrl } from '@/entities/user'
import { leaveApp } from '@/shared/lib/location'
import { clearReturnWorkspace } from '@/shared/lib/return-workspace'
import { useAuthNext } from './useAuthNext'

/**
 * 카카오 로그인을 시작한다. 전체 이동이라 메모리 상태는 사라지지만 복귀 공간은 sessionStorage 에 남는다.
 * 돌아오면 `useEnterSession` 을 거치지 않으므로, 앞 사용자의 복귀 공간이 다음 사용자에게 넘어가지 않게 여기서 지운다.
 */
export function useStartKakao(): () => void {
  const next = useAuthNext()
  return useCallback(() => {
    clearReturnWorkspace()
    leaveApp(kakaoStartUrl(next))
  }, [next])
}
