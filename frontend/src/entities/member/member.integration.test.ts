import { unwrap } from '@/shared/api/envelope'
import type { Envelope, ListDto } from '@/shared/types/api/envelope'
import type { MemberDto } from '@/shared/types/api/member'
import type { DiscordUserDto, MemberAliasDto } from '@/shared/types/api/member'
import { toDiscordUser, toMember, toMemberAlias, toUnresolvedAlias } from './model/mapper'
import type { UnresolvedAliasDto } from '@/shared/types/api/member'
import { setMockRole } from '@/shared/mock/sessions'

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
    body: JSON.stringify({ alias_text: '재환이' }),
  })
  const alias = toMemberAlias(
    unwrap((await created.json()) as Envelope<MemberAliasDto>, created.status),
  )
  expect(alias).toMatchObject({ text: '재환이', memberId: 'mb_03', source: 'manual' })
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
    body: JSON.stringify({ alias_text: '민수 님' }),
  })
  expect(
    unwrap((await firstCreated.json()) as Envelope<MemberAliasDto>, firstCreated.status).alias_id,
  ).toBe('al_11')
  expect((await fetch(`${base}/members/aliases/al_01`, { method: 'DELETE' })).status).toBe(204)

  const created = await fetch(`${base}/members/mb_03/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias_text: '새 별칭' }),
  })
  const alias = unwrap((await created.json()) as Envelope<MemberAliasDto>, created.status)
  expect(alias.alias_id).toBe('al_12')
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
  const listed = unwrap(
    (await aliases.json()) as Envelope<ListDto<MemberAliasDto>>,
    aliases.status,
  ).items.map(toMemberAlias)
  // 최근에 만든 것부터 온다
  expect(listed.slice(0, 2)).toMatchObject([
    { text: '재한', source: 'learned' },
    { text: '서연', source: 'manual' },
  ])
  expect(new Set(listed.map(({ source }) => source))).toEqual(
    new Set(['manual', 'display_name', 'discord_profile', 'learned']),
  )
  expect(listed.find(({ text }) => text === '하늘이')).toMatchObject({
    memberId: 'mb_04',
    verified: false,
  })
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

// 백엔드 matching.py resolved_alias_texts 는 워크스페이스 안에서 alias_text 로 묶어
// 후보가 정확히 1개이고 그 1개가 verified 일 때만 해결로 본다.
// 미검증 후보만 있거나, 후보가 둘 이상(검증 1 + 미검증 1 포함)이면 미해결로 남는다
describe('unresolved aliases', () => {
  const base = `${location.origin}/api/v1`
  const unresolved = async () => {
    const response = await fetch(`${base}/members/unresolved-aliases?workspace_id=ws_01`)
    return unwrap(
      (await response.json()) as Envelope<ListDto<UnresolvedAliasDto>>,
      response.status,
    ).items.map(({ alias_text }) => alias_text)
  }
  const addAlias = async (memberId: string, verified: boolean) => {
    const response = await fetch(`${base}/members/${memberId}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias_text: '지훈', verified }),
    })
    expect(response.status).toBe(201)
  }

  it('keeps a name unresolved while its only candidate is unverified', async () => {
    expect(await unresolved()).toEqual(['지훈'])
    await addAlias('mb_01', false)
    expect(await unresolved()).toEqual(['지훈'])
  })

  it('resolves a name with one verified candidate and reopens it when another is verified', async () => {
    await addAlias('mb_02', true)
    expect(await unresolved()).toEqual([])

    // 두 팀원에 붙으면 중의적이라 다시 미해결이다
    await addAlias('mb_03', true)
    expect(await unresolved()).toEqual(['지훈'])
  })

  it('keeps a name unresolved when a verified and an unverified candidate coexist', async () => {
    await addAlias('mb_01', false)
    await addAlias('mb_02', true)
    expect(await unresolved()).toEqual(['지훈'])
  })
})

// 백엔드는 같은 workspace_id + member_id + alias_text 면 기존 행을 그대로 돌려준다.
// 새로 만들면 미해결 별칭의 "후보 정확히 1개 + 그 1개가 verified" 계산까지 실제와 달라진다
// (matching.py resolved_alias_texts)
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

describe('alias writes', () => {
  const base = `${location.origin}/api/v1`
  const post = (memberId: string, body: unknown) =>
    fetch(`${base}/members/${memberId}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const read = async (response: Response) =>
    unwrap((await response.json()) as Envelope<MemberAliasDto>, response.status)
  const remove = (aliasId: string) =>
    fetch(`${base}/members/aliases/${aliasId}`, { method: 'DELETE' })

  it('rejects writes from a non-PM member and leaves the aliases alone', async () => {
    setMockRole('member')
    const created = await post('mb_03', { alias_text: '새 별칭' })
    expect(created.status).toBe(403)
    expect(await created.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect((await remove('al_10')).status).toBe(403)
    // 별칭이 없으면 권한보다 먼저 404 다
    expect((await remove('al_99')).status).toBe(404)

    const listed = await fetch(`${base}/members/aliases?workspace_id=ws_01`)
    const items = unwrap(
      (await listed.json()) as Envelope<ListDto<MemberAliasDto>>,
      listed.status,
    ).items
    expect(items.map(({ alias_text }) => alias_text)).toContain('재한')
    expect(items.map(({ alias_text }) => alias_text)).not.toContain('새 별칭')
  })

  it('stores the text trimmed with inner whitespace collapsed', async () => {
    expect(await read(await post('mb_03', { alias_text: '  재환   대리 ' }))).toMatchObject({
      alias_text: '재환 대리',
      source: 'manual',
      verified: true,
    })
  })

  it('rejects blank, over-100 and server-only display_name requests with 400', async () => {
    for (const body of [
      { alias_text: '   ' },
      { alias_text: '가'.repeat(101) },
      { alias_text: '새 별칭', source: 'display_name' },
    ]) {
      const response = await post('mb_03', body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    }
    expect((await post('mb_03', { alias_text: '가'.repeat(100) })).status).toBe(201)
    expect((await post('mb_99', { alias_text: '새 별칭' })).status).toBe(404)
  })

  it('upgrades an automatic alias to manual when a PM adds the same text', async () => {
    expect(await read(await post('mb_02', { alias_text: '민수' }))).toMatchObject({
      alias_id: 'al_04',
      source: 'manual',
      alias_type: 'nickname',
    })
    expect(await read(await post('mb_04', { alias_text: '하늘이' }))).toMatchObject({
      alias_id: 'al_09',
      source: 'manual',
      verified: true,
      confidence: 1,
    })
    // 사람이 정한 별칭과 자동 출처로 다시 넣는 요청은 그대로 둔다
    expect(
      await read(await post('mb_01', { alias_text: '서연', source: 'learned' })),
    ).toMatchObject({ alias_id: 'al_01', source: 'manual' })
    expect(
      await read(await post('mb_03', { alias_text: '이재환', source: 'discord_profile' })),
    ).toMatchObject({ alias_id: 'al_05', source: 'display_name' })
    // 다른 팀원은 같은 글자를 가져도 된다
    expect(await read(await post('mb_01', { alias_text: '민수' }))).toMatchObject({
      member_id: 'mb_01',
      alias_text: '민수',
    })
  })
})
