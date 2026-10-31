import { useMutation, useQueryClient } from '@tanstack/react-query'
import { disconnectIntegration, integrationsQueryOptions } from '@/entities/integration'
import type { IntegrationProvider } from '@/entities/integration'

/**
 * 연결 끊기. PM 만 한다 — 서버 `DELETE` 가 PM 전용이다. 성공한 뒤에 연동 상태를 다시 받아 화면에 반영한다 (D-137).
 * 실패하면 상태를 바꾸지 않고 호출자가 오류를 보인다
 */
export function useDisconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => disconnectIntegration(workspaceId, provider),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationsQueryOptions(workspaceId).queryKey }),
  })
}
