import { toIntegrations } from './mapper'
import { integrationFixtures } from '@/shared/mock/fixtures/integration'

it('adds provider names and preserves connected and null information', () => {
  expect(toIntegrations(integrationFixtures.ws_01).discord).toEqual({
    provider: 'discord',
    status: 'connected',
    displayName: '카테캠 3팀 서버',
    connectedAt: '2026-09-01T01:00:00Z',
  })
  expect(toIntegrations(integrationFixtures.ws_02).notion).toEqual({
    provider: 'notion',
    status: 'not_connected',
    displayName: null,
    connectedAt: null,
  })
})

it('keeps revoked distinct and falls back unknown statuses with a development warning', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      toIntegrations({
        discord: { status: 'revoked', display_name: null, connected_at: null },
        notion: { status: 'future', display_name: null, connected_at: null },
      }),
    ).toMatchObject({
      discord: { status: 'revoked' },
      notion: { status: 'not_connected' },
    })
    expect(warning).toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})
