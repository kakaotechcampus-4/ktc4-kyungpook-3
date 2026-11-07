import { paths } from '@/shared/config/routes'
import { useIntegrationConnection } from './useIntegrationConnection'
import type { IntegrationConnection, IntegrationConnectionNotice } from './useIntegrationConnection'

export type NotionConnectionNotice = IntegrationConnectionNotice

export type NotionConnection = IntegrationConnection<'notion'>

/**
 * 설정의 Notion 연결. 복귀 확인은 `useIntegrationConnection` 과 같다. 연결이 끝나도 설정에 머문다 —
 * Notion 은 선택 기능이라 연결을 기다리는 다른 화면이 없다 (D-182). OAuth 복귀 경로는 이 설정 영역(`section=notion`)이다.
 */
export function useNotionConnection(workspaceId: string): NotionConnection {
  return useIntegrationConnection(workspaceId, 'notion', {
    returnPath: paths.settingsNotion(workspaceId),
    connectedTo: null,
  })
}
