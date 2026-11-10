export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'canceled' | 'revoked'

/** 초대를 수락한 계정 */
export interface InvitedAccount {
  userId: string
  name: string
  /** 카카오로 가입한 계정은 이메일이 없다 (#627) */
  email: string | null
}

/** PM 이 보는 초대 한 건 */
export interface Invitation {
  id: string
  memberId: string
  email: string
  status: InvitationStatus
  /** 수락한 계정. 연결을 끊은 뒤에도 남는다. 계정이 지워졌으면 수락·끊김이어도 null 이다 */
  acceptedUser: InvitedAccount | null
  createdAt: string
}

/** 내가 받은 초대. 서버는 대기 중인 것만 준다 */
export interface MyInvitation {
  id: string
  workspaceId: string
  workspaceName: string
  memberDisplayName: string
  invitedByName: string | null
}
