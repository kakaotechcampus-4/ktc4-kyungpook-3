import type { ListDto } from './envelope'

export interface IntegrationDto {
  status: string
  display_name: string | null
  connected_at: string | null
}
/** 회의 채팅 채널 (#428). backend `ChatChannelResponse`·`DiscordChannelItem` 과 같은 모양이다 */
export interface ChatChannelDto {
  channel_id: string
  name: string
}
/** Discord 만 채팅 수집 채널을 가진다. 연결돼 있지 않거나 끈 상태면 null 이다 */
export interface DiscordIntegrationDto extends IntegrationDto {
  chat_channel: ChatChannelDto | null
}
export interface IntegrationsDto {
  discord: DiscordIntegrationDto
  notion: IntegrationDto
}
/** `GET /workspaces/{id}/discord/channels`. 연결한 서버의 텍스트 채널이다 */
export type DiscordChannelListDto = ListDto<ChatChannelDto>
/** `DELETE …/integrations/discord/chat-channel`. 끔 안내를 채널에 남겼으면 true 다 */
export interface ChatChannelClearDto {
  off_notice_sent: boolean
}
