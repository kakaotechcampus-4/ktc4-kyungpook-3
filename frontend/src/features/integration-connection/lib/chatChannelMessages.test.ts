import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { chatChannelFailure, chatChannelListFailure } from './chatChannelMessages'

const notAccessible = (details: Record<string, unknown> | null) =>
  new ApiError({ code: 'DISCORD_CHANNEL_NOT_ACCESSIBLE', message: 'raw', details }, 409)

describe('chatChannelFailure', () => {
  it('봇이 하지 못한 일(need)마다 Discord 에서 고칠 곳을 알린다', () => {
    expect(chatChannelFailure(notAccessible({ need: 'read' }))).toBe(
      '봇이 이 채널을 읽을 수 없어요. Discord 채널 설정의 권한에 봇을 추가해 주세요.',
    )
    expect(chatChannelFailure(notAccessible({ need: 'send' }))).toBe(
      '봇이 이 채널에 메시지를 보낼 수 없어요. Discord 채널 권한에서 봇에게 메시지 보내기 권한을 주세요.',
    )
  })

  it('need 가 없거나 모르는 값이면 공통 문구다', () => {
    const shared = '봇이 이 채널을 읽거나 메시지를 보낼 수 없어요. 채널 권한에 봇을 추가해 주세요.'
    expect(chatChannelFailure(notAccessible(null))).toBe(shared)
    expect(chatChannelFailure(notAccessible({ need: 'manage' }))).toBe(shared)
  })

  it('취소는 실패 문구가 없다', () => {
    expect(chatChannelFailure(createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED))).toBeNull()
  })
})

describe('chatChannelListFailure', () => {
  const failed = (code: string, status: number) =>
    new ApiError({ code, message: 'raw', details: null }, status)

  it('Discord 장애는 채널 목록을 못 가져왔다고 하고, 다른 코드는 저장 문구와 같다', () => {
    expect(chatChannelListFailure(failed('DISCORD_API_FAILED', 502))).toBe(
      'Discord에서 채널 목록을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(chatChannelListFailure(failed('INTEGRATION_NOT_CONNECTED', 409))).toBe(
      chatChannelFailure(failed('INTEGRATION_NOT_CONNECTED', 409)),
    )
    expect(
      chatChannelListFailure(createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED)),
    ).toBeNull()
  })
})
