import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { removePushSubscription } from '@/entities/notification'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { clearUserScope } from '../lib/userScope'
import { PASSWORD_CHANGED_STATE } from './passwordReset'

/**
 * 비밀번호를 바꾼 뒤. 서버가 그 계정의 세션을 모두 끊었으므로 이 브라우저의 세션 상태도 로그아웃처럼 비우고
 * 안내와 함께 로그인으로 보낸다. 자동 로그인은 없다.
 * 순서는 useLogout 과 같다 — 세션을 null 로 바꾸는 것과 이동이 같은 틱이라, 로그인한 채 연 링크여도
 * 로그인 화면의 RedirectIfAuthed 가 돌려보내지 않는다.
 * 이 브라우저의 푸시 구독도 푼다. 서버 세션이 이미 없어 구독 DELETE 는 401 이 될 수 있지만 브라우저 `unsubscribe` 는
 * 그와 상관없이 한다(removePushSubscription) — 공유 기기에 앞 계정의 알림이 뜨지 않게 한다.
 * 세션을 먼저 null 로 두므로 그 401 이 세션 만료 처리를 다시 부르지 않는다.
 */
export function useFinishPasswordReset(): () => Promise<void> {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useCallback(async () => {
    queryClient.setQueryData(SESSION_QUERY_KEY, null)
    void navigate(paths.login(), { replace: true, state: PASSWORD_CHANGED_STATE })
    await Promise.all([
      clearUserScope(queryClient),
      removePushSubscription().catch(() => undefined),
    ])
  }, [navigate, queryClient])
}
