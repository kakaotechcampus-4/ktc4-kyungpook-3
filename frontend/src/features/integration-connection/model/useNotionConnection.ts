import { useSearchParams } from 'react-router'
import { paths, SETTINGS_PARAMS } from '@/shared/config/routes'
import { uploadReturnTarget } from '../lib/uploadReturn'
import { useIntegrationConnection } from './useIntegrationConnection'
import type { IntegrationConnection, IntegrationConnectionNotice } from './useIntegrationConnection'

export type NotionConnectionNotice = IntegrationConnectionNotice

export interface NotionConnection extends IntegrationConnection {
  /** 연결이 끝나면 돌아갈 업로드 경로. 차단 모달에서 오지 않았으면 null */
  returnTo: string | null
}

/**
 * 설정의 Notion 연결. 복귀 확인은 `useIntegrationConnection` 과 같다.
 * Notion 만 차단 모달에서 올 수 있다 — `next` 가 그 공간의 업로드 경로면 연결이 확인된 뒤 업로드 화면으로
 * `replace` 이동한다 (D-098). OAuth 복귀 경로는 이 설정 영역(`section=notion`)이고 `next` 를 그대로 싣는다.
 * 확인 중 다른 곳으로 가려고 고르는 중이면 옮기지 않고 연결됨과 `회의 올리기로 돌아가기` 링크가 남는다.
 */
export function useNotionConnection(workspaceId: string): NotionConnection {
  const [searchParams] = useSearchParams()
  const returnTo = uploadReturnTarget(workspaceId, searchParams.get(SETTINGS_PARAMS.next))
  const connection = useIntegrationConnection(workspaceId, 'notion', {
    returnPath: paths.settingsNotion(workspaceId, returnTo ?? undefined),
    connectedTo: returnTo,
  })
  return { ...connection, returnTo }
}
