import { http } from 'msw'
import { db } from '../db'
import { list, ok, fail } from '../envelope'
import { requireMember, requirePmRole } from '../auth-guard'

const CHAT_CHANNEL_PATH = '/api/v1/workspaces/:workspaceId/integrations/discord/chat-channel'

/** 백엔드 `ChatChannelSetRequest` — 앞뒤 공백을 지운 숫자 1~20자 */
function readChannelId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const value: unknown = (body as Record<string, unknown>).channel_id
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^[0-9]{1,20}$/.test(trimmed) ? trimmed : null
}

function notConnected() {
  return fail('INTEGRATION_NOT_CONNECTED', '연동이 필요합니다.', 409, { provider: 'discord' })
}

export const integrationHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/integrations', ({ params }) => {
    const denied = requireMember(String(params.workspaceId))
    if (denied) return denied
    const integrations = db.integrations[String(params.workspaceId)]
    return integrations
      ? ok(integrations)
      : fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
  }),
  http.get('/api/v1/workspaces/:workspaceId/discord/channels', ({ params }) => {
    // 백엔드는 get_current_pm 을 건다 (integrations.py 의 list_discord_channels). 텍스트 채널만 준다
    const denied = requirePmRole(String(params.workspaceId))
    if (denied) return denied
    if (db.integrations[String(params.workspaceId)]?.discord.status !== 'connected')
      return notConnected()
    return list(db.discordChannels.map(({ channel_id, name }) => ({ channel_id, name })))
  }),
  http.put(CHAT_CHANNEL_PATH, async ({ params, request }) => {
    // 순서는 백엔드 chat_channel.set_chat_channel 과 같다 — 연결 → 같은 채널 → 목록 → 읽기 → 켬 안내. 실패하면 저장하지 않는다
    const denied = requirePmRole(String(params.workspaceId))
    if (denied) return denied
    const channelId = readChannelId(await request.json().catch(() => null))
    if (channelId === null) return fail('INVALID_REQUEST', '요청 형식이 올바르지 않습니다.', 400)
    const discord = db.integrations[String(params.workspaceId)]?.discord
    if (discord?.status !== 'connected') return notConnected()
    if (discord.chat_channel?.channel_id === channelId) return ok(discord.chat_channel)
    const channel = db.discordChannels.find((item) => item.channel_id === channelId)
    if (channel === undefined)
      return fail(
        'DISCORD_CHANNEL_NOT_FOUND',
        '연결된 Discord 서버에서 이 텍스트 채널을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
        404,
        { channel_id: channelId },
      )
    if (channel.access !== 'ok')
      return fail(
        'DISCORD_CHANNEL_NOT_ACCESSIBLE',
        '봇이 이 채널을 읽거나 메시지를 보낼 수 없습니다. 채널 권한에 봇을 추가해 주세요.',
        409,
        channel.access === 'no_read'
          ? { channel_id: channelId, need: 'read', discord_code: 50001 }
          : { channel_id: channelId, need: 'send', discord_code: 50013 },
      )
    discord.chat_channel = { channel_id: channel.channel_id, name: channel.name }
    return ok(discord.chat_channel)
  }),
  http.delete(CHAT_CHANNEL_PATH, ({ params }) => {
    // 연결이 없거나 이미 꺼져 있어도 200 이다. 모의 Discord 는 끔 안내를 늘 남긴다
    const denied = requirePmRole(String(params.workspaceId))
    if (denied) return denied
    const discord = db.integrations[String(params.workspaceId)]?.discord
    const hadChannel = discord?.chat_channel != null
    if (discord) discord.chat_channel = null
    return ok({ off_notice_sent: hadChannel })
  }),
  http.delete('/api/v1/workspaces/:workspaceId/integrations/:provider', ({ params }) => {
    // 백엔드는 get_current_pm 을 건다 (integrations.py 의 delete_integration)
    const denied = requirePmRole(String(params.workspaceId))
    if (denied) return denied
    const integrations = db.integrations[String(params.workspaceId)]
    if (!integrations) return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    // 백엔드는 provider 를 검증하지 않는다. 해당 행이 없으면 지울 게 없을 뿐 204 다.
    // 알 수 없는 provider 로도 400 이 나지 않는다. Discord 행을 지우면 채팅 수집 채널도 함께 사라진다.
    const disconnected = {
      status: 'not_connected' as const,
      display_name: null,
      connected_at: null,
    }
    if (params.provider === 'discord')
      integrations.discord = { ...disconnected, chat_channel: null }
    if (params.provider === 'notion') integrations.notion = disconnected
    // 실 API 는 204 무본문이다 (계약 §4.0-②-8). 봉투로 바꿔 달라고 요청해 두었지만
    // MSW 는 요청한 미래 형태가 아니라 현재 동작을 흉내낸다. 그래야 화면이 실 API 에서 안 깨진다.
    return new Response(null, { status: 204 })
  }),
]
