export interface IntegrationDto {
  status: string
  display_name: string | null
  connected_at: string | null
}
export interface IntegrationsDto {
  discord: IntegrationDto
  notion: IntegrationDto
}
