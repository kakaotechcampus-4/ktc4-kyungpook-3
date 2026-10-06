export type IntegrationProvider = 'discord' | 'notion'
export type IntegrationStatus = 'not_connected' | 'connected' | 'revoked'
/** 연결돼 있지 않은 두 상태. 미연결(D-097)과 끊김(D-100)은 안내가 다르다 */
export type DisconnectedStatus = Exclude<IntegrationStatus, 'connected'>
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
