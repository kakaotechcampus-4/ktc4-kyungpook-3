export type IntegrationProvider = 'discord' | 'notion'
export type IntegrationStatus = 'not_connected' | 'connected' | 'revoked'
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
