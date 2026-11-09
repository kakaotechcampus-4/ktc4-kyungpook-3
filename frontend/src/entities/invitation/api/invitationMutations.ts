import { request } from '@/shared/api/client'
import type { InvitationCreateDto } from '@/shared/types/api/invitation'

/*
 * 응답 본문은 읽지 않는다. 화면은 성공 뒤 목록을 다시 받는다 — 다시 초대·연결 끊기는 다른 초대도 함께 닫는다.
 */

/** 같은 팀원에게 열린 초대가 있으면 서버가 취소하고 새로 만든다 */
export async function createInvitation(
  workspaceId: string,
  input: { memberId: string; email: string },
  signal?: AbortSignal,
): Promise<void> {
  const body: InvitationCreateDto = { member_id: input.memberId, email: input.email }
  await request(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
    method: 'POST',
    body,
    signal,
  })
}

async function invitationAction(
  invitationId: string,
  action: string,
  signal?: AbortSignal,
): Promise<void> {
  await request(`/invitations/${encodeURIComponent(invitationId)}/${action}`, {
    method: 'POST',
    signal,
  })
}

export function cancelInvitation(invitationId: string, signal?: AbortSignal): Promise<void> {
  return invitationAction(invitationId, 'cancel', signal)
}

export function revokeInvitation(invitationId: string, signal?: AbortSignal): Promise<void> {
  return invitationAction(invitationId, 'revoke', signal)
}

export function acceptInvitation(invitationId: string): Promise<void> {
  return invitationAction(invitationId, 'accept')
}

export function declineInvitation(invitationId: string): Promise<void> {
  return invitationAction(invitationId, 'decline')
}
