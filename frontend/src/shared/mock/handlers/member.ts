import { http } from 'msw'
import { db } from '../db'
import { fail, list, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
const base = '/api/v1'
export const memberHandlers = [
  http.get(`${base}/members/aliases`, ({ request }) => {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id')
    return workspaceId
      ? list(
          db.aliases
            .filter(({ workspace_id }) => workspace_id === workspaceId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        )
      : fail('INVALID_REQUEST', 'workspace_id가 필요합니다.', 400)
  }),
  http.get(`${base}/members/unresolved-aliases`, ({ request }) => {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id')
    return workspaceId
      ? list(workspaceId === 'ws_01' ? db.unresolvedAliases : [])
      : fail('INVALID_REQUEST', 'workspace_id가 필요합니다.', 400)
  }),
  http.delete(`${base}/members/aliases/:aliasId`, ({ params }) => {
    const index = db.aliases.findIndex(({ alias_id }) => alias_id === params.aliasId)
    if (index < 0) return fail('MEMBER_ALIAS_NOT_FOUND', '별칭이 없습니다.', 404)
    db.aliases.splice(index, 1)
    return new Response(null, { status: 204 })
  }),
  http.get(`${base}/workspaces/:workspaceId/discord/members`, ({ params }) => {
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === params.workspaceId))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    return db.integrations[String(params.workspaceId)]?.discord.status === 'connected'
      ? list(params.workspaceId === 'ws_01' ? db.discordUsers : [])
      : fail('INTEGRATION_NOT_CONNECTED', 'Discord 연결이 필요합니다.', 409)
  }),
  http.get(`${base}/members`, ({ request }) => {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id')
    return workspaceId
      ? list(db.members.filter(({ workspace_id }) => workspace_id === workspaceId))
      : fail('INVALID_REQUEST', 'workspace_id가 필요합니다.', 400)
  }),
  http.post(`${base}/members`, async ({ request }) => {
    const body = (await request.json()) as {
      workspace_id?: unknown
      display_name?: unknown
      discord_user_id?: unknown
      notion_name?: unknown
      role?: unknown
    }
    if (typeof body.workspace_id !== 'string' || typeof body.display_name !== 'string')
      return fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400)
    if (
      body.display_name.length === 0 ||
      body.display_name.length > 100 ||
      (body.role !== undefined && body.role !== 'pm' && body.role !== 'member')
    )
      return fail('INVALID_REQUEST', '팀원 요청이 올바르지 않습니다.', 400)
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === body.workspace_id))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    if (
      typeof body.discord_user_id === 'string' &&
      db.members.some(
        (member) =>
          member.workspace_id === body.workspace_id &&
          member.discord_user_id === body.discord_user_id,
      )
    )
      return fail('DISCORD_USER_ALREADY_MAPPED', '이미 연결된 Discord 사용자입니다.', 409)
    const member = {
      member_id: `mb_${String(db.members.length + 1).padStart(2, '0')}`,
      workspace_id: body.workspace_id,
      display_name: body.display_name,
      discord_user_id: typeof body.discord_user_id === 'string' ? body.discord_user_id : null,
      notion_name: typeof body.notion_name === 'string' ? body.notion_name : null,
      role: body.role === 'pm' ? 'pm' : 'member',
      created_at: MOCK_NOW,
    }
    db.members.push(member)
    return ok(member, { status: 201 })
  }),
  http.get(`${base}/members/:memberId`, ({ params }) => {
    const member = db.members.find(({ member_id }) => member_id === params.memberId)
    return member ? ok(member) : fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
  }),
  http.patch(`${base}/members/:memberId`, async ({ params, request }) => {
    const member = db.members.find(({ member_id }) => member_id === params.memberId)
    if (!member) return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
    const body = (await request.json()) as {
      discord_user_id?: unknown
      display_name?: unknown
      notion_name?: unknown
      role?: unknown
    }
    if (
      typeof body.discord_user_id === 'string' &&
      db.members.some(
        (candidate) =>
          candidate.member_id !== member.member_id &&
          candidate.workspace_id === member.workspace_id &&
          candidate.discord_user_id === body.discord_user_id,
      )
    )
      return fail('DISCORD_USER_ALREADY_MAPPED', '이미 연결된 Discord 사용자입니다.', 409)
    if (
      'discord_user_id' in body &&
      (typeof body.discord_user_id === 'string' || body.discord_user_id === null)
    )
      member.discord_user_id = body.discord_user_id
    if (typeof body.display_name === 'string') member.display_name = body.display_name
    if (
      'notion_name' in body &&
      (typeof body.notion_name === 'string' || body.notion_name === null)
    )
      member.notion_name = body.notion_name
    if (body.role === 'pm' || body.role === 'member') member.role = body.role
    return ok(member)
  }),
  http.post(`${base}/members/:memberId/aliases`, async ({ params, request }) => {
    const member = db.members.find(({ member_id }) => member_id === params.memberId)
    if (!member) return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
    const body = (await request.json()) as {
      alias_text?: unknown
      alias_type?: unknown
      source?: unknown
      confidence?: unknown
      verified?: unknown
    }
    const validType =
      body.alias_type === undefined ||
      (typeof body.alias_type === 'string' &&
        ['realname', 'nickname', 'mention', 'inferred'].includes(body.alias_type))
    const validSource =
      body.source === undefined ||
      (typeof body.source === 'string' &&
        ['manual', 'discord_profile', 'learned'].includes(body.source))
    if (typeof body.alias_text !== 'string' || !validType || !validSource)
      return fail('INVALID_REQUEST', '별칭 요청이 올바르지 않습니다.', 400)
    const alias = {
      alias_id: `al_${String(db.aliases.length + 1).padStart(2, '0')}`,
      member_id: member.member_id,
      workspace_id: member.workspace_id,
      alias_text: body.alias_text,
      alias_type: typeof body.alias_type === 'string' ? body.alias_type : 'nickname',
      source: typeof body.source === 'string' ? body.source : 'manual',
      confidence: typeof body.confidence === 'number' ? body.confidence : 1,
      verified: typeof body.verified === 'boolean' ? body.verified : true,
      created_at: MOCK_NOW,
    }
    db.aliases.push(alias)
    return ok(alias, { status: 201 })
  }),
]
