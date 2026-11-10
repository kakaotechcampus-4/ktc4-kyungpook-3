import type { ChatChannel } from '../model/types'

/** 채널을 화면에 쓰는 이름. 서버에 이름이 남지 않은 채널은 짐작하지 않고 ID 로 가리킨다 (#348 리뷰) */
export function chatChannelLabel({ channelId, name }: ChatChannel): string {
  return name === null ? `이름 없는 채널(${channelId})` : `#${name}`
}
