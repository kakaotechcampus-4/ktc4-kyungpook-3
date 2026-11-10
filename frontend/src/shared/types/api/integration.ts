import { z } from 'zod'

/*
 * 연동 응답 스키마 (backend app/api/integrations.py·app/schemas/integration.py, 계약 §4.3). FE 가 읽는 필드만 본다.
 * 타입은 이 스키마에서 만든다 (#348)
 */

/**
 * 연동 상태. 연결 버튼·끊기·`준비 중` 재조회·온보딩 단계 완료를 정해 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다.
 * 전에는 미연결로 읽어 연결된 공간에 다시 연결하라고 했다
 */
export const integrationStatusSchema = z.enum([
  'not_connected',
  'connecting',
  'connected',
  'revoked',
])

const integrationSchema = z.object({
  status: integrationStatusSchema,
  display_name: z.string().nullable(),
  connected_at: z.string().nullable(),
})
export type IntegrationDto = z.infer<typeof integrationSchema>

/**
 * 회의 채팅 채널 (#428). backend `ChatChannelResponse`·`DiscordChannelItem` 과 같은 모양이다.
 * 저장한 채널의 이름 칸(`chat_channel_name`)은 nullable 이라 이름 없이 올 수 있다. 그 하나로 연동 응답 전체를 거절하지 않는다
 */
export const chatChannelSchema = z.object({ channel_id: z.string(), name: z.string().nullable() })
export type ChatChannelDto = z.infer<typeof chatChannelSchema>

export const integrationsSchema = z.object({
  // Discord 만 채팅 수집 채널을 가진다. 연결돼 있지 않거나 끈 상태면 null 이다
  discord: integrationSchema.extend({ chat_channel: chatChannelSchema.nullable() }),
  notion: integrationSchema,
})
export type IntegrationsDto = z.infer<typeof integrationsSchema>

/** `GET /workspaces/{id}/discord/channels`. 연결한 서버의 텍스트 채널이다 */
export const discordChannelListSchema = z.object({ items: z.array(chatChannelSchema) })

/** `DELETE …/integrations/discord/chat-channel`. 끔 안내를 채널에 남겼으면 true 다 */
export const chatChannelClearSchema = z.object({ off_notice_sent: z.boolean() })
