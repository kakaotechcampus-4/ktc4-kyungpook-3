import { integrationFixtures } from '@/shared/mock/fixtures/integration'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import { chatChannelClearSchema, discordChannelListSchema, integrationsSchema } from './integration'

const valid = {
  discord: {
    status: 'connected',
    display_name: '서버',
    connected_at: '2026-09-01T00:00:00Z',
    chat_channel: null,
  },
  notion: { status: 'not_connected', display_name: null, connected_at: null },
}

describe('연동 스키마', () => {
  it('모르는 연동 상태는 미연결로 바꾸지 않고 응답 전체를 읽지 않는다', () => {
    const result = integrationsSchema.safeParse({
      ...valid,
      notion: { ...valid.notion, status: 'paused' },
    })
    expect(result.error?.issues[0]?.path).toEqual(['notion', 'status'])
  })

  it.each([
    ['채팅 채널 누락', { discord: { ...valid.discord, chat_channel: undefined } }],
    ['연결 시각 숫자', { notion: { ...valid.notion, connected_at: 3 } }],
    ['Notion 칸 누락', { notion: undefined }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(integrationsSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it('끔 안내 여부가 불리언이 아니면 읽지 않는다', () => {
    expect(chatChannelClearSchema.safeParse({ off_notice_sent: 'yes' }).success).toBe(false)
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('연동 픽스처', () => {
    for (const fixture of Object.values(integrationFixtures)) integrationsSchema.parse(fixture)
  })

  it('기본 상태의 연동과 Discord 채널 목록', async () => {
    applyScenario('dashboard-default')
    integrationsSchema.parse(await fetchDto('/workspaces/ws_01/integrations'))
    const { items } = discordChannelListSchema.parse(
      await fetchDto('/workspaces/ws_01/discord/channels'),
    )
    expect(items.length).toBeGreaterThan(0)
  })
})
