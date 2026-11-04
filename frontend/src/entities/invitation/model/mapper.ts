import type { InvitationDto, MyInvitationDto } from '@/shared/types/api/invitation'
import type { Invitation, InvitationStatus, MyInvitation } from './types'

const statuses: InvitationStatus[] = ['pending', 'accepted', 'declined', 'canceled', 'revoked']

/** 모르는 상태는 닫힌 초대(canceled)로 읽는다 — 다시 초대할 수 있고 연결로 보지 않는다 */
export function toInvitation(dto: InvitationDto): Invitation {
  const known = statuses.includes(dto.status as InvitationStatus)
  if (!known && import.meta.env.DEV) console.warn(`Unknown invitation status: ${dto.status}`)
  return {
    id: dto.invitation_id,
    memberId: dto.member_id,
    email: dto.email,
    status: known ? (dto.status as InvitationStatus) : 'canceled',
    acceptedUser: dto.accepted_user && {
      userId: dto.accepted_user.user_id,
      name: dto.accepted_user.name,
      email: dto.accepted_user.email,
    },
    createdAt: dto.created_at,
  }
}

export function toMyInvitation(dto: MyInvitationDto): MyInvitation {
  return {
    id: dto.invitation_id,
    workspaceId: dto.workspace_id,
    workspaceName: dto.workspace_name,
    memberDisplayName: dto.member_display_name,
    invitedByName: dto.invited_by_name,
  }
}
