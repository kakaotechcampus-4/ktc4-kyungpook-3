import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import { toIntegrations } from '../model/mapper'
import type { Integrations } from '../model/types'

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
 */
export function integrationsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'integrations'),
    queryFn: ({ signal }) => fetchIntegrations(workspaceId, signal),
  })
}
