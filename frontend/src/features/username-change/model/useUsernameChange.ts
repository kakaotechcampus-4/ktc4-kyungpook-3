import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SESSION_QUERY_KEY, updateUsername } from '@/entities/user'
import type { Session, User } from '@/entities/user'
import { CLIENT_ERROR_CODES, createClientError, isInvalidResponse } from '@/shared/api/errors'
import type { SessionScope } from '@/shared/api/sessionScope'
import { showWriteUnconfirmed } from '@/shared/ui/toast'

interface ChangeVariables {
  /** 중복 확인을 마친 정규화한 아이디 */
  username: string
  /** 누를 때의 세션. 그 세션이 끝났으면 보내지 않는다 (#594) */
  session: SessionScope
}

/**
 * `PATCH /users/me` 로 아이디를 바꾼다 (#627). 성공하면 세션 캐시의 user 를 응답으로 바꾼다 — 다시 묻지 않는다.
 * 응답을 읽지 못하면 바뀌었을 수 있어 실패라고 하지 않고 쓰기 토스트를 띄운다. `새로고침` 은 세션을 다시 받는다 (D-184)
 */
export function useUsernameChange() {
  const queryClient = useQueryClient()
  return useMutation<User, unknown, ChangeVariables>({
    mutationFn: ({ username, session }) => {
      // 오프라인으로 기다리는 사이 로그아웃·다시 로그인했을 수 있다. 그대로 보내면 다음 계정의 아이디를 바꾼다
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return updateUsername(username, session.signal)
    },
    onSuccess: (user, { session }) => {
      if (!session.isCurrent()) return
      queryClient.setQueryData<Session | null>(SESSION_QUERY_KEY, (cached) =>
        cached ? { ...cached, user } : cached,
      )
    },
    onError: (error, { session }) => {
      if (!session.isCurrent() || !isInvalidResponse(error)) return
      showWriteUnconfirmed(
        () => void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY, exact: true }),
      )
    },
  })
}
