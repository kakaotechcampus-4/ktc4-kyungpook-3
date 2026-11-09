import { useMutation, useQueryClient } from '@tanstack/react-query'
import { disconnectIntegration, integrationsQueryOptions } from '@/entities/integration'
import type { IntegrationProvider } from '@/entities/integration'
import { messageSettingsQueryOptions } from '@/entities/message-settings'
import { CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import type { SessionScope } from '@/shared/api/sessionScope'

/**
 * 연결 끊기. PM 만 한다 — 서버 `DELETE` 가 PM 전용이다. 실패하면 상태를 바꾸지 않고 호출자가 오류를 보인다.
 * 성공하면 서버가 끊은 결과(행이 지워져 미연결)를 먼저 캐시에 쓰고 연동 상태를 다시 받는다 (D-137) — 다시 받기가 실패해도
 * 카드가 `연결됨` 에 남아 같은 끊기를 또 누르게 하지 않는다. `onDisconnected` 는 카드가 미연결로 바뀌기 직전에 부른다.
 * Discord 를 끊으면 알림 설정의 PM 연결 상태(`pms`)도 바뀐다 — 그것도 다시 받는다 (#340). 회의 채팅 채널도 함께 꺼진다 (#428)
 * 변수는 누를 때의 세션 범위다. 그 세션이 끝났으면 보내지 않고 뒷처리도 하지 않는다 (#594)
 */
export function useDisconnectIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  onDisconnected?: () => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (session: SessionScope) => {
      if (!session.isCurrent()) throw createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)
      return disconnectIntegration(workspaceId, provider, session.signal)
    },
    onSuccess: (_, session) => {
      if (!session.isCurrent()) return
      const { queryKey } = integrationsQueryOptions(workspaceId)
      onDisconnected?.()
      queryClient.setQueryData(queryKey, (current) => {
        if (!current) return current
        const cleared = { status: 'not_connected', displayName: null, connectedAt: null } as const
        // 서버는 Discord 행을 지우며 회의 채팅 채널도 함께 지운다
        return provider === 'discord'
          ? { ...current, discord: { ...current.discord, ...cleared, chatChannel: null } }
          : { ...current, notion: { ...current.notion, ...cleared } }
      })
      if (provider === 'discord')
        void queryClient.invalidateQueries({
          queryKey: messageSettingsQueryOptions(workspaceId).queryKey,
        })
      return queryClient.invalidateQueries({ queryKey })
    },
  })
}
