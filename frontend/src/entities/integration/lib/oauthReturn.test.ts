import { readIntegrationReturn } from './oauthReturn'

describe('readIntegrationReturn', () => {
  it.each(['success', 'cancelled', 'failed'] as const)(
    '%s 결과를 provider 와 함께 읽는다',
    (outcome) => {
      expect(
        readIntegrationReturn(new URLSearchParams({ oauth: 'discord', oauth_result: outcome })),
      ).toEqual({ provider: 'discord', outcome })
    },
  )

  it('결과가 없거나 모르는 provider·결과면 null 이다', () => {
    expect(readIntegrationReturn(new URLSearchParams())).toBeNull()
    expect(
      readIntegrationReturn(new URLSearchParams({ oauth: 'slack', oauth_result: 'success' })),
    ).toBeNull()
    expect(
      readIntegrationReturn(new URLSearchParams({ oauth: 'notion', oauth_result: 'maybe' })),
    ).toBeNull()
  })
})
