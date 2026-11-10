import type { InvitationDto, MyInvitationDto, UserSummaryDto } from '@/shared/types/api/invitation'
import type { Invitation, Invitee, MyInvitation } from './types'

export function toInvitee(dto: UserSummaryDto): Invitee {
  return { userId: dto.user_id, username: dto.username, name: dto.name }
}

export function toInvitation(dto: InvitationDto): Invitation {
  return {
    id: dto.invitation_id,
    memberId: dto.member_id,
    invitedUser: toInvitee(dto.invited_user),
    status: dto.status,
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
