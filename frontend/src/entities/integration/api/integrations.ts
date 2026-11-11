import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import {
  chatChannelClearSchema,
  chatChannelSchema,
  discordChannelListSchema,
  integrationsSchema,
} from '@/shared/types/api/integration'
import { CONNECTING_POLL_MS } from '../lib/waitWhileConnecting'
import { toChatChannel, toIntegrations } from '../model/mapper'
import type { ChatChannel, IntegrationProvider, Integrations } from '../model/types'

const workspacePath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`

export async function fetchIntegrations(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Integrations> {
  return toIntegrations(
    parseResponse(
      integrationsSchema,
      await request<unknown>(`${workspacePath(workspaceId)}/integrations`, { signal }),
      'integration',
    ),
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
  signal?: AbortSignal,
): Promise<void> {
  await request<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/integrations/${encodeURIComponent(provider)}`,
    { method: 'DELETE', signal },
  )
}

/** 연결한 Discord 서버의 텍스트 채널. PM 만 받는다. 연결이 없으면 409 `INTEGRATION_NOT_CONNECTED` 다 */
export async function fetchDiscordChannels(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<ChatChannel[]> {
  const { items } = parseResponse(
    discordChannelListSchema,
    await request<unknown>(`${workspacePath(workspaceId)}/discord/channels`, { signal }),
    'integration',
  )
  return items.map(toChatChannel)
}

/** 회의 채팅 채널 고르기의 선택지 (#429) */
export function discordChannelsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'discord-channels'),
    queryFn: ({ signal }) => fetchDiscordChannels(workspaceId, signal),
  })
}

/**
 * 채팅 자동 수집 채널을 정한다 (#428). 서버가 채널을 읽어 보고 켬 안내를 보낸 뒤에만 저장한다 — 실패하면 아무것도 바뀌지 않는다.
 * 이미 고른 채널이면 Discord 를 부르지 않고 그대로 돌려준다
 */
export async function setChatChannel(
  workspaceId: string,
  channelId: string,
  signal?: AbortSignal,
): Promise<ChatChannel> {
  return toChatChannel(
    parseResponse(
      chatChannelSchema,
      await request<unknown>(`${workspacePath(workspaceId)}/integrations/discord/chat-channel`, {
        method: 'PUT',
        body: { channel_id: channelId },
        signal,
      }),
      'integration',
    ),
  )
}

/** 채팅 자동 수집을 끈다. 이미 꺼져 있어도 성공이다. `offNoticeSent` 는 채널에 끔 안내를 남겼는지다 */
export async function clearChatChannel(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<{ offNoticeSent: boolean }> {
  const dto = parseResponse(
    chatChannelClearSchema,
    await request<unknown>(`${workspacePath(workspaceId)}/integrations/discord/chat-channel`, {
      method: 'DELETE',
      signal,
    }),
    'integration',
  )
  return { offNoticeSent: dto.off_notice_sent }
}
