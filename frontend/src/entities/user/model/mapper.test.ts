import { toSession } from './mapper'

it('maps a session DTO', () => {
  expect(
    toSession({
      user: { user_id: 'us_01', email: 'pm@example.com', name: '최진호', avatar_url: null },
      workspace_count: 2,
      last_workspace_id: 'ws_01',
    }),
  ).toMatchObject({
    user: { id: 'us_01', avatarUrl: null },
    workspaceCount: 2,
    lastWorkspaceId: 'ws_01',
  })
})

it('preserves an avatar and null last workspace', async () => {
  const { toSession } = await import('./mapper')
  expect(
    toSession({
      user: {
        user_id: 'us_02',
        email: 'a@example.com',
        name: 'A',
        avatar_url: 'https://example.com/a.png',
      },
      workspace_count: 0,
      last_workspace_id: null,
    }),
  ).toEqual({
    user: {
      id: 'us_02',
      email: 'a@example.com',
      name: 'A',
      avatarUrl: 'https://example.com/a.png',
    },
    workspaceCount: 0,
    lastWorkspaceId: null,
  })
})
