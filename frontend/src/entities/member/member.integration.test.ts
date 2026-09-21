import { unwrap } from '@/shared/api/envelope'
import type { Envelope, ListDto } from '@/shared/types/api/envelope'
import type { MemberDto } from '@/shared/types/api/member'
import type { DiscordUserDto, MemberAliasDto } from '@/shared/types/api/member'
import { toDiscordUser, toMember, toMemberAlias, toUnresolvedAlias } from './model/mapper'
import type { UnresolvedAliasDto } from '@/shared/types/api/member'

it('scopes members and supports unlinking a Discord user', async () => {
  const list = await fetch('http://localhost:3000/api/v1/members?workspace_id=ws_01')
  const members = unwrap((await list.json()) as Envelope<ListDto<MemberDto>>, list.status)
  expect(members.total).toBe(4)
  expect(toMember(members.items[0])).toMatchObject({ id: 'mb_01', discordUserId: '1123' })
  const update = await fetch('http://localhost:3000/api/v1/members/mb_01', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discord_user_id: null }),
  })
  expect(
    toMember(unwrap((await update.json()) as Envelope<MemberDto>, update.status)).discordUserId,
  ).toBeNull()
  const persisted = await fetch('http://localhost:3000/api/v1/members/mb_01')
  expect(
    toMember(unwrap((await persisted.json()) as Envelope<MemberDto>, persisted.status))
      .discordUserId,
  ).toBeNull()
})

it('creates, lists and deletes aliases and maps unresolved names', async () => {
  const base = `${location.origin}/api/v1`
  const created = await fetch(`${base}/members/mb_03/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_text: '재환' }),
  })
  const alias = toMemberAlias(
    unwrap((await created.json()) as Envelope<MemberAliasDto>, created.status),
  )
  expect(alias).toMatchObject({ text: '재환', memberId: 'mb_03' })
  expect((await fetch(`${base}/members/aliases/${alias.id}`, { method: 'DELETE' })).status).toBe(
    204,
  )
  expect((await fetch(`${base}/members/aliases/${alias.id}`, { method: 'DELETE' })).status).toBe(
    404,
  )
  const unresolved = await fetch(`${base}/members/unresolved-aliases?workspace_id=ws_01`)
  expect(
    unwrap(
      (await unresolved.json()) as Envelope<ListDto<UnresolvedAliasDto>>,
      unresolved.status,
    ).items.map(toUnresolvedAlias),
  ).toEqual([{ text: '지훈', occurrences: 3, lastSeenAt: '2026-09-15T06:00:00Z' }])
  expect((await fetch(`${base}/workspaces/ws_02/discord/members`)).status).toBe(409)
})

it('keeps alias ids unique after an alias is deleted', async () => {
  const base = `${location.origin}/api/v1`
  const firstCreated = await fetch(`${base}/members/mb_02/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_text: '민수' }),
  })
  expect(
    unwrap((await firstCreated.json()) as Envelope<MemberAliasDto>, firstCreated.status).alias_id,
  ).toBe('al_02')
  expect((await fetch(`${base}/members/aliases/al_01`, { method: 'DELETE' })).status).toBe(204)

  const created = await fetch(`${base}/members/mb_03/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_text: '새 별칭' }),
  })
  const alias = unwrap((await created.json()) as Envelope<MemberAliasDto>, created.status)
  expect(alias.alias_id).toBe('al_03')
})

it('creates a member, rejects invalid roles and requires an existing workspace', async () => {
  const send = (body: unknown) =>
    fetch(`${location.origin}/api/v1/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const created = await send({ workspace_id: 'ws_01', display_name: '새 팀원' })
  expect(
    toMember(unwrap((await created.json()) as Envelope<MemberDto>, created.status)),
  ).toMatchObject({ displayName: '새 팀원', role: 'member', discordUserId: null })
  expect((await send({ workspace_id: 'missing', display_name: '새 팀원' })).status).toBe(404)
  expect(
    (await send({ workspace_id: 'ws_01', display_name: '새 팀원', role: 'owner' })).status,
  ).toBe(400)
})

it('covers Discord users, aliases, workspace scoping, duplicate mapping, and missing members', async () => {
  const discord = await fetch('http://localhost:3000/api/v1/workspaces/ws_01/discord/members')
  const users = unwrap(
    (await discord.json()) as Envelope<ListDto<DiscordUserDto>>,
    discord.status,
  ).items.map(toDiscordUser)
  expect(users).toHaveLength(4)
  expect(users.find(({ discordUserId }) => discordUserId === '1199')).toMatchObject({ isBot: true })
  const aliases = await fetch('http://localhost:3000/api/v1/members/aliases?workspace_id=ws_01')
  expect(
    unwrap((await aliases.json()) as Envelope<ListDto<MemberAliasDto>>, aliases.status).items.map(
      toMemberAlias,
    ),
  ).toMatchObject([{ text: '서연', type: 'nickname' }])
  const ws2 = await fetch('http://localhost:3000/api/v1/members?workspace_id=ws_02')
  expect(unwrap((await ws2.json()) as Envelope<ListDto<MemberDto>>, ws2.status).total).toBe(0)
  const duplicate = await fetch('http://localhost:3000/api/v1/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace_id: 'ws_01', display_name: '중복', discord_user_id: '1123' }),
  })
  expect(duplicate.status).toBe(409)
  const missing = await fetch('http://localhost:3000/api/v1/members/missing')
  expect(missing.status).toBe(404)
})
