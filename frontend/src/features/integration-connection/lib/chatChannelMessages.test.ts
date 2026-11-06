import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { chatChannelFailure } from './chatChannelMessages'

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
