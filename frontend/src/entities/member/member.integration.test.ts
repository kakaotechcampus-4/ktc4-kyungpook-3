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

// 백엔드는 워크스페이스 안에서 verified 별칭이 정확히 1개인 이름만 해결된 것으로 본다
// (members.py 의 group_by + having count == 1). 미검증·복수 verified 는 미해결로 남는다
it('drops a detected name from the unresolved list once exactly one verified alias exists', async () => {
  const base = `${location.origin}/api/v1`
  const unresolved = async () => {
    const response = await fetch(`${base}/members/unresolved-aliases?workspace_id=ws_01`)
    return unwrap(
      (await response.json()) as Envelope<ListDto<UnresolvedAliasDto>>,
      response.status,
    ).items.map(({ alias_text }) => alias_text)
  }
  expect(await unresolved()).toEqual(['지훈'])

  const addAlias = (memberId: string, verified: boolean) =>
    fetch(`${base}/members/${memberId}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias_text: '지훈', verified }),
    })

  // 미검증 별칭은 해결로 치지 않는다
  await addAlias('mb_01', false)
  expect(await unresolved()).toEqual(['지훈'])

  // verified 가 하나 생기면 목록에서 빠진다
  const first = await addAlias('mb_02', true)
  expect(first.status).toBe(201)
  expect(await unresolved()).toEqual([])

  // 두 팀원에 붙으면 중의적이라 다시 미해결이다
  await addAlias('mb_03', true)
  expect(await unresolved()).toEqual(['지훈'])
})

// 백엔드는 같은 workspace_id + member_id + alias_text 면 기존 행을 그대로 돌려준다.
// 새로 만들면 미해결 별칭의 "verified 정확히 1개" 계산까지 실제와 달라진다 (members.py)
it('returns the existing alias instead of creating a duplicate', async () => {
  const base = `${location.origin}/api/v1`
  const create = () =>
    fetch(`${base}/members/mb_01/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias_text: '중복 별칭' }),
    })

  const first = await create()
  expect(first.status).toBe(201)
  const firstAlias = unwrap((await first.json()) as Envelope<MemberAliasDto>, first.status)

  const second = await create()
  // 라우트 선언이 status_code=201 이라 기존 행을 돌려줘도 201 이다. 200 이 아니다
  expect(second.status).toBe(201)
  const secondAlias = unwrap((await second.json()) as Envelope<MemberAliasDto>, second.status)
  expect(secondAlias.alias_id).toBe(firstAlias.alias_id)

  const listed = await fetch(`${base}/members/aliases?workspace_id=ws_01`)
  const aliases = unwrap((await listed.json()) as Envelope<ListDto<MemberAliasDto>>, listed.status)
  expect(aliases.items.filter(({ alias_text }) => alias_text === '중복 별칭')).toHaveLength(1)
})
