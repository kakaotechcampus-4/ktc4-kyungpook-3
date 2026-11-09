import { http } from 'msw'
import { db } from '../db'
import { fail, list, ok } from '../envelope'
import { requireMember, requirePmRole } from '../auth-guard'
import { MOCK_NOW } from '../fixtures/constants'
import { nextId } from '../utils'
import { linkedUserIdOf } from '../sessions'
const base = '/api/v1'
export const memberHandlers = [
  http.get(`${base}/members/aliases`, ({ request }) => {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id')
    return workspaceId
      ? list(
          db.aliases
            .filter(
              ({ workspace_id, member_id }) =>
                workspace_id === workspaceId && !db.withdrawnMemberIds.includes(member_id),
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        )
      : fail('INVALID_REQUEST', 'workspace_id가 필요합니다.', 400)
  }),
  http.get(`${base}/members/unresolved-aliases`, ({ request }) => {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id')
    if (!workspaceId) return fail('INVALID_REQUEST', 'workspace_id가 필요합니다.', 400)
    // 백엔드 matching.py resolved_alias_texts 는 워크스페이스 안에서 alias_text 로 묶어
    // 후보가 **정확히 1개**이고 그 1개가 verified 인 이름만 해결된 것으로 본다.
    // 미검증 후보만 있거나 검증 1 + 미검증 1 처럼 후보가 여럿이면 미해결로 남는다.
    const counts = new Map<string, { total: number; verified: number }>()
    for (const alias of db.aliases) {
      if (alias.workspace_id !== workspaceId) continue
      const count = counts.get(alias.alias_text) ?? { total: 0, verified: 0 }
      count.total += 1
      if (alias.verified) count.verified += 1
      counts.set(alias.alias_text, count)
    }
    const resolved = (aliasText: string) => {
      const count = counts.get(aliasText)
      return count?.total === 1 && count.verified === 1
    }
    const detected = workspaceId === 'ws_01' ? db.unresolvedAliases : []
    return list(detected.filter(({ alias_text }) => !resolved(alias_text)))
  }),
  http.delete(`${base}/members/aliases/:aliasId`, ({ params }) => {
    const index = db.aliases.findIndex(({ alias_id }) => alias_id === params.aliasId)
    if (index < 0) return fail('MEMBER_ALIAS_NOT_FOUND', '별칭이 없습니다.', 404)
    // 백엔드는 별칭을 찾은 뒤 그 공간의 PM 인지 본다 (members.py 의 delete_alias)
    const denied = requirePmRole(db.aliases[index].workspace_id)
    if (denied) return denied
    db.aliases.splice(index, 1)
    return new Response(null, { status: 204 })
  }),
  http.get(`${base}/workspaces/:workspaceId/discord/members`, ({ params }) => {
    // 백엔드는 integrations.py 에 있고 get_current_member 를 건다
    const denied = requireMember(String(params.workspaceId))
    if (denied) return denied
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === params.workspaceId))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    // 모의 Discord 서버는 하나다. 어느 공간이든 연결만 되면 같은 사용자 목록을 돌려준다 —
    // 새로 만든 공간도 Discord 연결 뒤 팀원 연결 단계를 진행할 수 있어야 한다
    return db.integrations[String(params.workspaceId)]?.discord.status === 'connected'
      ? list(db.discordUsers)
      : fail('INTEGRATION_NOT_CONNECTED', 'Discord 연결이 필요합니다.', 409)
  }),
  http.get(`${base}/members`, ({ request }) => {
    const params = new URL(request.url).searchParams
    const workspaceId = params.get('workspace_id')
    const includeWithdrawn = params.get('include_withdrawn') === 'true'
    return workspaceId
      ? list(
          db.members
            .filter(
              ({ workspace_id, member_id }) =>
                workspace_id === workspaceId &&
                (includeWithdrawn || !db.withdrawnMemberIds.includes(member_id)),
            )
            .map((member) => ({
              ...member,
              has_login_account: linkedUserIdOf(member.member_id) !== null,
            })),
        )
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
    // 백엔드는 공간을 찾은 뒤 require_pm 을 본다 (members.py 의 create_member)
    const denied = requirePmRole(body.workspace_id)
    if (denied) return denied
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
      has_login_account: false,
      created_at: MOCK_NOW,
    }
    db.members.push(member)
    return ok(member, { status: 201 })
  }),
  http.get(`${base}/members/:memberId`, ({ params }) => {
    const member = db.members.find(
      ({ member_id }) =>
        member_id === params.memberId && !db.withdrawnMemberIds.includes(member_id),
    )
    return member
      ? ok({ ...member, has_login_account: linkedUserIdOf(member.member_id) !== null })
      : fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
  }),
  http.patch(`${base}/members/:memberId`, async ({ params, request }) => {
    const member = db.members.find(
      ({ member_id }) =>
        member_id === params.memberId && !db.withdrawnMemberIds.includes(member_id),
    )
    if (!member) return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
    // 백엔드는 팀원을 찾은 뒤 그 공간의 PM 인지 본다 (members.py 의 _get_member(..., pm=True))
    const denied = requirePmRole(member.workspace_id)
    if (denied) return denied
    const body = (await request.json()) as {
      discord_user_id?: unknown
      display_name?: unknown
      notion_name?: unknown
      role?: unknown
    }
    // 초대를 기다리는 팀원을 PM 으로 올리면 수락한 계정이 곧바로 PM 이 된다. 아무것도 바꾸지 않고 막는다 (결정 0036)
    if (
      body.role === 'pm' &&
      member.role !== 'pm' &&
      db.invitations.some(
        ({ member_id, status }) => member_id === member.member_id && status === 'pending',
      )
    )
      return fail('MEMBER_HAS_PENDING_INVITATION', '대기 중인 초대가 있는 팀원입니다.', 409)
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
    return ok({ ...member, has_login_account: linkedUserIdOf(member.member_id) !== null })
  }),
  http.post(`${base}/members/:memberId/aliases`, async ({ params, request }) => {
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
    // display_name 은 서버가 이름에서 채우는 출처라 받지 않는다 (schemas/member.py)
    const validSource =
      body.source === undefined ||
      (typeof body.source === 'string' &&
        ['manual', 'discord_profile', 'learned'].includes(body.source))
    // 길이는 받은 그대로 문자(코드 포인트)로 재고(Python len), 저장은 앞뒤 공백을 지우고 안쪽 공백을 한 칸으로 줄인 값이다 (matching.py normalize_alias_text)
    const aliasText =
      typeof body.alias_text === 'string' && [...body.alias_text].length <= 100
        ? body.alias_text.trim().replace(/\s+/g, ' ')
        : ''
    if (aliasText === '' || !validType || !validSource)
      return fail('INVALID_REQUEST', '별칭 요청이 올바르지 않습니다.', 400)
    // 본문 검증(400) 다음에 팀원을 찾고(404) 그 공간의 PM 인지 본다 (members.py 의 _get_member(..., pm=True))
    const member = db.members.find(
      ({ member_id }) =>
        member_id === params.memberId && !db.withdrawnMemberIds.includes(member_id),
    )
    if (!member) return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404)
    const denied = requirePmRole(member.workspace_id)
    if (denied) return denied
    const aliasType = typeof body.alias_type === 'string' ? body.alias_type : 'nickname'
    const source = typeof body.source === 'string' ? body.source : 'manual'
    const confidence = typeof body.confidence === 'number' ? body.confidence : 1
    const verified = typeof body.verified === 'boolean' ? body.verified : true
    // 백엔드는 같은 workspace_id + member_id + alias_text 가 있으면 기존 행을 돌려준다.
    const duplicate = db.aliases.find(
      (existing) =>
        existing.workspace_id === member.workspace_id &&
        existing.member_id === member.member_id &&
        existing.alias_text === aliasText,
    )
    if (duplicate) {
      // 자동 별칭(이름·디스코드 닉네임)을 사람이 정한 출처로 다시 넣으면 그 출처로 올린다
      if (
        (duplicate.source === 'display_name' || duplicate.source === 'discord_profile') &&
        (source === 'manual' || source === 'learned')
      )
        Object.assign(duplicate, { alias_type: aliasType, source, confidence, verified })
      // 라우트 선언이 status_code=201 이라 기존 행을 돌려줘도 201 이다 (members.py:215)
      return ok(duplicate, { status: 201 })
    }
    const alias = {
      alias_id: nextId(
        'al',
        db.aliases.map(({ alias_id }) => alias_id),
      ),
      member_id: member.member_id,
      workspace_id: member.workspace_id,
      alias_text: aliasText,
      alias_type: aliasType,
      source,
      confidence,
      verified,
      created_at: MOCK_NOW,
    }
    db.aliases.push(alias)
    return ok(alias, { status: 201 })
  }),
]
