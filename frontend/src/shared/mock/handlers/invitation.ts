import { http } from 'msw'
import type { InvitationDto, MyInvitationDto } from '@/shared/types/api/invitation'

/** 모의 서버의 초대 응답. 화면이 읽지 않는 칸도 백엔드처럼 낸다 */
type InvitationResponse = InvitationDto & {
  member_display_name: string
  invited_by_name: string | null
  responded_at: string | null
}
type MyInvitationResponse = MyInvitationDto & { created_at: string }
import { db } from '../db'
import type { MockInvitation } from '../db'
import { fail, list, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { requireAuth, requirePmRole } from '../auth-guard'
import { isMemberOf, linkedUserIdOf } from '../sessions'
import { nextId, readJson } from '../utils'
import { invalidBody, stringField } from '../validation'

/*
 * 팀원 초대 (계약 §5.9). 검사 순서는 백엔드 api/invitations.py 와 같다.
 * 초대는 가입한 계정(`invited_user_id`)에 묶인다 (#628). 그 계정이 탈퇴하면 탈퇴 handler 가 초대를 지운다.
 */

const notFound = (invitationId: string) =>
  fail('INVITATION_NOT_FOUND', '초대를 찾을 수 없습니다.', 404, { invitation_id: invitationId })
const notPending = (invitationId: string) =>
  fail('INVITATION_NOT_PENDING', '대기 중인 초대가 아닙니다.', 409, {
    invitation_id: invitationId,
  })

const accountOf = (userId: string | null) =>
  db.accounts.find(({ session }) => session.user.user_id === userId)

function accountName(userId: string | null): string | null {
  return accountOf(userId)?.session.user.name ?? null
}

function memberOf(invitation: MockInvitation) {
  return db.members.find(({ member_id }) => member_id === invitation.member_id)
}

function toDto(invitation: MockInvitation): InvitationResponse {
  const invited = accountOf(invitation.invited_user_id)?.session.user
  if (!invited) throw new Error(`mock invited account ${invitation.invited_user_id} is missing`)
  const accepted = accountOf(invitation.accepted_user_id)
  return {
    invitation_id: invitation.invitation_id,
    member_id: invitation.member_id,
    member_display_name: memberOf(invitation)?.display_name ?? '',
    invited_user: { user_id: invited.user_id, username: invited.username, name: invited.name },
    status: invitation.status,
    invited_by_name: accountName(invitation.invited_by_user_id),
    accepted_user: accepted
      ? {
          user_id: accepted.session.user.user_id,
          name: accepted.session.user.name,
          email: accepted.session.user.email,
        }
      : null,
    created_at: invitation.created_at,
    responded_at: invitation.responded_at,
  }
}

const newestFirst = (a: MockInvitation, b: MockInvitation) =>
  Date.parse(b.created_at) - Date.parse(a.created_at)

/** 가장 늦은 초대보다 1초 뒤. 다시 초대한 것이 늘 더 최근이고 결과가 매번 같다 */
function nextCreatedAt(): string {
  if (db.invitations.length === 0) return new Date(MOCK_NOW).toISOString()
  const latest = Math.max(...db.invitations.map(({ created_at }) => Date.parse(created_at)))
  return new Date(latest + 1000).toISOString()
}

/** 수락·끊기·취소 시각. 초대를 만든 뒤라야 한다 */
const respondedAt = (invitation: MockInvitation) =>
  new Date(Date.parse(invitation.created_at) + 1000).toISOString()

function closePending(predicate: (invitation: MockInvitation) => boolean): void {
  for (const invitation of db.invitations) {
    if (invitation.status === 'pending' && predicate(invitation)) {
      invitation.status = 'canceled'
      invitation.responded_at = respondedAt(invitation)
    }
  }
}

/** PM 쪽 동작(취소·끊기)의 대상. 없으면 404, 그 공간 PM 이 아니면 403 */
function pmInvitation(invitationId: string) {
  const invitation = db.invitations.find(({ invitation_id }) => invitation_id === invitationId)
  if (!invitation) return notFound(invitationId)
  return requirePmRole(invitation.workspace_id) ?? invitation
}

/** 나에게 온 초대가 아니면 있는지도 알리지 않는다(404). 팀원이 지워졌으면 닫힌 초대다 */
function myPendingInvitation(invitationId: string) {
  const invitation = db.invitations.find(({ invitation_id }) => invitation_id === invitationId)
  if (!invitation || invitation.invited_user_id !== db.session.user.user_id)
    return notFound(invitationId)
  if (invitation.status !== 'pending' || !memberOf(invitation)) return notPending(invitationId)
  return invitation
}

export const invitationHandlers = [
  http.post('/api/v1/workspaces/:workspaceId/invitations', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const body = (await readJson(request)) ?? {}
    const bodyError = invalidBody(stringField(body, 'member_id'), stringField(body, 'user_id'))
    if (bodyError) return bodyError
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const userId = body.user_id as string
    // 탈퇴한 계정은 행이 없다(accounts 에서 빠진다)
    if (!accountOf(userId))
      return fail('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.', 404, { user_id: userId })
    const member = db.members.find(
      ({ member_id, workspace_id }) => member_id === body.member_id && workspace_id === workspaceId,
    )
    if (!member || db.withdrawnMemberIds.includes(member.member_id))
      return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404, { member_id: body.member_id })
    const details = { member_id: member.member_id }
    if (linkedUserIdOf(member.member_id) !== null)
      return fail('MEMBER_ALREADY_LINKED', '이미 계정이 연결된 팀원입니다.', 409, details)
    if (member.role === 'pm')
      return fail('PM_MEMBER_NOT_INVITABLE', 'PM 팀원은 초대할 수 없습니다.', 409, details)
    if (isMemberOf(workspaceId, userId))
      return fail('ALREADY_WORKSPACE_MEMBER', '이미 워크스페이스 팀원입니다.', 409, {
        user_id: userId,
      })
    if (
      db.invitations.some(
        (invitation) =>
          invitation.workspace_id === workspaceId &&
          invitation.invited_user_id === userId &&
          invitation.status === 'pending' &&
          invitation.member_id !== member.member_id,
      )
    )
      return fail('USER_ALREADY_INVITED', '이 사용자에게 대기 중인 초대가 있습니다.', 409, {
        user_id: userId,
      })
    const createdAt = nextCreatedAt()
    closePending((invitation) => invitation.member_id === member.member_id)
    const invitation: MockInvitation = {
      invitation_id: nextId(
        'iv',
        db.invitations.map(({ invitation_id }) => invitation_id),
      ),
      workspace_id: workspaceId,
      member_id: member.member_id,
      invited_user_id: userId,
      status: 'pending',
      invited_by_user_id: db.session.user.user_id,
      accepted_user_id: null,
      created_at: createdAt,
      responded_at: null,
    }
    db.invitations.push(invitation)
    return ok(toDto(invitation), { status: 201 })
  }),
  http.get('/api/v1/workspaces/:workspaceId/invitations', ({ params }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    return list(
      db.invitations
        .filter(({ workspace_id }) => workspace_id === workspaceId)
        .sort(newestFirst)
        .map(toDto),
    )
  }),
  http.post('/api/v1/invitations/:invitationId/cancel', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const invitation = pmInvitation(String(params.invitationId))
    if (invitation instanceof Response) return invitation
    if (invitation.status !== 'pending') return notPending(invitation.invitation_id)
    invitation.status = 'canceled'
    invitation.responded_at = respondedAt(invitation)
    return ok(toDto(invitation))
  }),
  http.post('/api/v1/invitations/:invitationId/revoke', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const invitation = pmInvitation(String(params.invitationId))
    if (invitation instanceof Response) return invitation
    if (invitation.status !== 'accepted')
      return fail('INVITATION_NOT_ACCEPTED', '수락한 초대가 아닙니다.', 409, {
        invitation_id: invitation.invitation_id,
      })
    const member = memberOf(invitation)
    // 백엔드 _ensure_other_pm: 로그인 계정이 이어진 다른 PM 이 남아야 한다
    if (
      member?.role === 'pm' &&
      !db.members.some(
        (other) =>
          other.member_id !== member.member_id &&
          other.workspace_id === member.workspace_id &&
          other.role === 'pm' &&
          linkedUserIdOf(other.member_id) !== null,
      )
    )
      return fail('LAST_PM_REQUIRED', 'PM이 한 명은 있어야 합니다.', 409, {
        workspace_id: invitation.workspace_id,
        member_id: invitation.member_id,
      })
    invitation.status = 'revoked'
    invitation.responded_at = respondedAt(invitation)
    // 끊긴 계정이 자기에게 남은 대기 초대로 돌아오지 못하게 함께 닫는다
    closePending(
      ({ workspace_id, invited_user_id }) =>
        workspace_id === invitation.workspace_id && invited_user_id === invitation.invited_user_id,
    )
    return ok(toDto(invitation))
  }),
  http.get('/api/v1/invitations/me', () => {
    const denied = requireAuth()
    if (denied) return denied
    return list(
      db.invitations
        .filter(
          (invitation) =>
            invitation.invited_user_id === db.session.user.user_id &&
            invitation.status === 'pending' &&
            memberOf(invitation) !== undefined,
        )
        .sort(newestFirst)
        .map((invitation): MyInvitationResponse => ({
          invitation_id: invitation.invitation_id,
          workspace_id: invitation.workspace_id,
          workspace_name:
            db.workspaces.find(({ workspace_id }) => workspace_id === invitation.workspace_id)
              ?.name ?? '',
          member_display_name: memberOf(invitation)?.display_name ?? '',
          invited_by_name: accountName(invitation.invited_by_user_id),
          created_at: invitation.created_at,
        })),
    )
  }),
  http.post('/api/v1/invitations/:invitationId/accept', ({ params }) => {
    const denied = requireAuth()
    if (denied) return denied
    const invitation = myPendingInvitation(String(params.invitationId))
    if (invitation instanceof Response) return invitation
    if (linkedUserIdOf(invitation.member_id) !== null)
      return fail('MEMBER_ALREADY_LINKED', '이미 계정이 연결된 팀원입니다.', 409, {
        member_id: invitation.member_id,
      })
    if (isMemberOf(invitation.workspace_id))
      return fail('ALREADY_WORKSPACE_MEMBER', '이미 워크스페이스 팀원입니다.', 409, {
        workspace_id: invitation.workspace_id,
      })
    // 마지막 공간(last_workspace_id)은 바꾸지 않는다 — 백엔드 accept_invitation 과 같다
    invitation.status = 'accepted'
    invitation.accepted_user_id = db.session.user.user_id
    invitation.responded_at = respondedAt(invitation)
    return ok({ workspace_id: invitation.workspace_id, member_id: invitation.member_id })
  }),
  http.post('/api/v1/invitations/:invitationId/decline', ({ params }) => {
    const denied = requireAuth()
    if (denied) return denied
    const invitation = myPendingInvitation(String(params.invitationId))
    if (invitation instanceof Response) return invitation
    invitation.status = 'declined'
    invitation.responded_at = respondedAt(invitation)
    return ok({ invitation_id: invitation.invitation_id, status: 'declined' })
  }),
]
