export type IntegrationProvider = 'discord' | 'notion'
/** `connecting` 은 Notion 토큰은 받았고 템플릿의 DB 를 찾아 붙이는 중이다 (#204, backend integrations._notion_status) */
export type IntegrationStatus = 'not_connected' | 'connecting' | 'connected' | 'revoked'
/** 연결돼 있지 않은 두 상태. 미연결(D-097)과 끊김(D-100)은 안내가 다르다 */
export type DisconnectedStatus = Exclude<IntegrationStatus, 'connected' | 'connecting'>
export interface Integration {
  provider: IntegrationProvider
  status: IntegrationStatus
  displayName: string | null
  connectedAt: string | null
}
export interface Integrations {
  discord: Integration
  notion: Integration
}
