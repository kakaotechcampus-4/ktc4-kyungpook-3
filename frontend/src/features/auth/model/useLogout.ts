import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { SESSION_QUERY_KEY, logout } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { guardLeave } from '@/shared/lib/unsaved-changes'
import { clearUserScope } from '../lib/userScope'

/** 로그아웃 실패 안내. 이 기능 전용 문구다 */
export const LOGOUT_FAILED_MESSAGE = '로그아웃하지 못했어요. 다시 시도해 주세요.'

export interface LogoutControl {
  /** 누르면 부른다. 저장하지 않은 변경이 있으면 먼저 공통 이탈 확인을 연다 */
  requestLogout: () => void
  isPending: boolean
  /** 마지막 시도의 실패. 다시 시도하면 지워진다 */
  error: unknown
}

/**
 * 로그아웃. **서버 성공 뒤에만** 캐시를 정리하고 로그인으로 옮긴다 (D-165).
 * 실패하면 아무것도 지우지 않는다 — 화면과 캐시가 그대로 남고 다시 시도할 수 있다.
 *
 * 이동은 관문을 다시 타지 않는다. 이탈 확인은 요청 전에 이미 거쳤고, 뒤따르는 정리가 등록을 푼다.
 * 세션을 null 로 바꾸는 것과 이동은 같은 틱이다. 보호 화면의 RequireAuth 가 같은 로그인으로 보내도 한 곳이다.
 */
export function useLogout(): LogoutControl {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      // 세션을 먼저 null 로 바꾸고 바로 옮긴다. 정리를 먼저 하면 아직 떠 있는 보호 화면의 구독이
      // 지워진 목록을 다시 불러 401 을 한 번 더 만든다
      queryClient.setQueryData(SESSION_QUERY_KEY, null)
      void navigate(paths.login(), { replace: true })
      // 같은 틱에 세션 세대를 올리고 요청을 취소한다. 취소로 떨어진 이전 화면의 뒷처리는 바뀐 세대를 보고 알리지 않는다
      await clearUserScope(queryClient)
    },
  })
  const { mutate, isPending, error } = mutation

  const requestLogout = useCallback(() => {
    if (isPending) return
    guardLeave(() => mutate())
  }, [isPending, mutate])

  return { requestLogout, isPending, error }
}
