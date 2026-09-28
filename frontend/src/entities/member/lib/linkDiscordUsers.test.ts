import { linkDiscordUsers } from './linkDiscordUsers'
import { discordUserFixtures, memberFixtures } from '@/shared/mock/fixtures/member'
import { toDiscordUser, toMember } from '../model/mapper'

it('links users, preserves inactive members, and excludes bots', () => {
  const members = [
    {
      id: 'm1',
      workspaceId: 'w',
      displayName: 'Kim',
      discordUserId: '1',
      notionName: null,
      role: 'pm' as const,
      createdAt: '',
    },
    {
      id: 'm2',
      workspaceId: 'w',
      displayName: 'Old',
      discordUserId: '2',
      notionName: null,
      role: 'member' as const,
      createdAt: '',
    },
  ]
  const users = [
    { discordUserId: '1', username: 'kim', displayName: null, avatarUrl: null, isBot: false },
    { discordUserId: '3', username: 'new', displayName: null, avatarUrl: null, isBot: false },
    { discordUserId: '4', username: 'bot', displayName: null, avatarUrl: null, isBot: true },
  ]
  expect(linkDiscordUsers(users, members).map(({ kind }) => kind)).toEqual([
    'linked',
    'unlinked',
    'inactive',
  ])
})

it('covers the fixture linked, unlinked and inactive rows without bots or never-linked members', () => {
  expect(
    linkDiscordUsers(discordUserFixtures.map(toDiscordUser), memberFixtures.map(toMember)).map(
      ({ kind, label }) => ({ kind, label }),
    ),
  ).toEqual([
    { kind: 'linked', label: '김서연' },
    { kind: 'linked', label: '박민수' },
    { kind: 'unlinked', label: 'jihun_dev' },
    { kind: 'inactive', label: '정하늘' },
  ])
})
