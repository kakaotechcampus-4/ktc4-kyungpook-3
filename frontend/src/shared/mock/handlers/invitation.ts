import { http } from 'msw'
import type { InvitationDto, MyInvitationDto } from '@/shared/types/api/invitation'
import { db } from '../db'
import type { MockInvitation } from '../db'
import { fail, list, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { requireAuth, requirePmRole } from '../auth-guard'
import { isMemberOf, linkedUserIdOf, normalizeEmail } from '../sessions'
import { nextId, readJson } from '../utils'

/*
 * 팀원 초대 (계약 §5.9). 검사 순서는 백엔드 api/invitations.py 와 같다.
 * 흉내내지 않는 것: POST /workspaces 의 생성자 팀원은 workspaceIds 로만 이어져 있어 linkedUserIdOf 가 모른다 —
 * 실 API 는 MEMBER_ALREADY_LINKED 인데 여기서는 PM_MEMBER_NOT_INVITABLE 이다.
 */

const notFound = (invitationId: string) =>
  fail('INVITATION_NOT_FOUND', '초대를 찾을 수 없습니다.', 404, { invitation_id: invitationId })
const notPending = (invitationId: string) =>
  fail('INVITATION_NOT_PENDING', '대기 중인 초대가 아닙니다.', 409, {
    invitation_id: invitationId,
  })

function accountName(userId: string | null): string | null {
  if (userId === null) return null
  return (
    db.accounts.find(({ session }) => session.user.user_id === userId)?.session.user.name ?? null
  )
}

function memberOf(invitation: MockInvitation) {
  return db.members.find(({ member_id }) => member_id === invitation.member_id)
}

function toDto(invitation: MockInvitation): InvitationDto {
  const accepted = db.accounts.find(
    ({ session }) => session.user.user_id === invitation.accepted_user_id,
  )
  return {
    invitation_id: invitation.invitation_id,
    member_id: invitation.member_id,
    member_display_name: memberOf(invitation)?.display_name ?? '',
    email: invitation.email,
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

/** 내 이메일로 온 초대가 아니면 있는지도 알리지 않는다(404). 팀원이 지워졌으면 닫힌 초대다 */
function myPendingInvitation(invitationId: string) {
  const invitation = db.invitations.find(({ invitation_id }) => invitation_id === invitationId)
  if (!invitation || invitation.email !== normalizeEmail(db.session.user.email))
    return notFound(invitationId)
  if (invitation.status !== 'pending' || !memberOf(invitation)) return notPending(invitationId)
  return invitation
}

export const invitationHandlers = [
  http.post('/api/v1/workspaces/:workspaceId/invitations', async ({ params, request }) => {
    const workspaceId = String(params.workspaceId)
    const denied = requirePmRole(workspaceId)
    if (denied) return denied
    const body = await readJson(request)
    if (
      typeof body?.member_id !== 'string' ||
      typeof body.email !== 'string' ||
      !/^[^@\s]+@[^@\s]+$/.test(body.email.trim())
    )
      return fail('INVALID_REQUEST', '초대 요청이 올바르지 않습니다.', 400)
    const email = normalizeEmail(body.email)
    const member = db.members.find(
      ({ member_id, workspace_id }) => member_id === body.member_id && workspace_id === workspaceId,
    )
    if (!member)
      return fail('MEMBER_NOT_FOUND', '팀원이 없습니다.', 404, { member_id: body.member_id })
    const details = { member_id: member.member_id }
    if (linkedUserIdOf(member.member_id) !== null)
      return fail('MEMBER_ALREADY_LINKED', '이미 계정이 연결된 팀원입니다.', 409, details)
    if (member.role === 'pm')
      return fail('PM_MEMBER_NOT_INVITABLE', 'PM 팀원은 초대할 수 없습니다.', 409, details)
    if (
      db.accounts.some(
        ({ session }) =>
          normalizeEmail(session.user.email) === email &&
          isMemberOf(workspaceId, session.user.user_id),
      )
    )
      return fail('ALREADY_WORKSPACE_MEMBER', '이미 워크스페이스 팀원입니다.', 409, { email })
    if (
      db.invitations.some(
        (invitation) =>
          invitation.workspace_id === workspaceId &&
          invitation.email === email &&
          invitation.status === 'pending' &&
          invitation.member_id !== member.member_id,
      )
    )
      return fail('EMAIL_ALREADY_INVITED', '이 이메일로 대기 중인 초대가 있습니다.', 409, { email })
    const createdAt = nextCreatedAt()
    closePending((invitation) => invitation.member_id === member.member_id)
    const invitation: MockInvitation = {
      invitation_id: nextId(
        'iv',
        db.invitations.map(({ invitation_id }) => invitation_id),
      ),
      workspace_id: workspaceId,
      member_id: member.member_id,
      email,
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
    // 끊긴 계정이 같은 이메일의 남은 대기 초대로 돌아오지 못하게 함께 닫는다
    closePending(
      ({ workspace_id, email }) =>
        workspace_id === invitation.workspace_id && email === invitation.email,
    )
    return ok(toDto(invitation))
  }),
  http.get('/api/v1/invitations/me', () => {
    const denied = requireAuth()
    if (denied) return denied
    const email = normalizeEmail(db.session.user.email)
    return list(
      db.invitations
        .filter(
          (invitation) =>
            invitation.email === email &&
            invitation.status === 'pending' &&
            memberOf(invitation) !== undefined,
        )
        .sort(newestFirst)
        .map((invitation): MyInvitationDto => ({
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
