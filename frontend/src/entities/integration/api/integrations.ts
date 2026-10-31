import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import { CONNECTING_POLL_MS } from '../lib/waitWhileConnecting'
import { toIntegrations } from '../model/mapper'
import type { IntegrationProvider, Integrations } from '../model/types'

export async function fetchIntegrations(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Integrations> {
  return toIntegrations(
    await request<IntegrationsDto>(`/workspaces/${encodeURIComponent(workspaceId)}/integrations`, {
      signal,
    }),
  )
}

/**
 * 연동 상태. OAuth 복귀 뒤에는 이 조회로 `connected` 를 확인하고서야 단계를 완료한다 —
 * 복귀 주소의 성공 표시만 믿지 않는다. 기본 staleTime(30초)을 쓰고 복귀 때는 호출자가 다시 받는다.
 * 어느 쪽이든 `connecting`(DB 를 붙이는 중)이면 구독하는 화면이 끝날 때까지 다시 묻는다 —
 * 새로고침 뒤나 다른 화면에서 봐도 `준비 중` 에 머물지 않는다 (#204)
 */
export function integrationsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'integrations'),
    queryFn: ({ signal }) => fetchIntegrations(workspaceId, signal),
    refetchInterval: ({ state }) =>
      state.data?.discord.status === 'connecting' || state.data?.notion.status === 'connecting'
        ? CONNECTING_POLL_MS
        : false,
  })
}

/**
 * 연동 해제. PM 만 할 수 있고 204 무본문이다 (계약 §4.3, §5.8). 이미 반영한 내용은 남고 새 내용만 쓰지 않는다.
 * 지울 행이 없어도 204 다. 화면은 성공 뒤 연동 상태를 다시 받는다 (D-137)
 */
export async function disconnectIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await request<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/integrations/${encodeURIComponent(provider)}`,
    { method: 'DELETE' },
  )
}
