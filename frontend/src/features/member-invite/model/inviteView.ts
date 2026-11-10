import type { Invitation, InvitationStatus } from '@/entities/invitation'
import type { Role } from '@/shared/types/common'

export type InviteChipTone = 'waiting' | 'linked' | 'signal' | 'closed'

/** 팀원 한 줄이 보일 초대 상태와 조작 */
export interface MemberInviteView {
  /** 초대한 적이 없으면 null */
  chip: { label: string; tone: InviteChipTone } | null
  /** 초대한 이메일. 수락이면 수락한 계정의 `이름 · 이메일`(계정이 지워졌으면 이메일만) */
  detail: string | null
  /** 연결된 팀원이면 null */
  invite: '초대' | '다시 초대' | null
  /** 최근 초대를 닫는 조작 */
  close: { kind: 'cancel' | 'revoke'; invitationId: string } | null
}

/* 거절은 PM 이 확인할 신호라 가장 눈에 띄는 톤이다 (결정 0036). 상태가 늘면 이 표에서 타입 오류가 난다 */
const STATUS_VIEW: Record<
  InvitationStatus,
  { label: string; tone: InviteChipTone; close: 'cancel' | 'revoke' | null }
> = {
  pending: { label: '대기', tone: 'waiting', close: 'cancel' },
  accepted: { label: '수락', tone: 'linked', close: 'revoke' },
  declined: { label: '거절', tone: 'signal', close: null },
  canceled: { label: '취소', tone: 'closed', close: null },
  revoked: { label: '연결 끊김', tone: 'closed', close: null },
}

/**
 * 팀원 한 줄이 무엇을 보이고 무엇을 할 수 있는지 정하는 한 곳. 연결 여부는 최근 초대가 수락인지로만 안다 —
 * 팀원 응답에 계정 연결 정보가 없다.
 * PM 팀원은 초대할 수 없다(409 PM_MEMBER_NOT_INVITABLE). 수락한 뒤 PM 이 된 팀원만 계정과 연결 끊기를 보이고,
 * 그 밖의 PM 팀원은 아무것도 보이지 않는다(null).
 */
export function memberInviteView(role: Role, latest: Invitation | null): MemberInviteView | null {
  if (role === 'pm' && latest?.status !== 'accepted') return null
  if (latest === null) return { chip: null, detail: null, invite: '초대', close: null }
  const status = STATUS_VIEW[latest.status]
  const accepted = latest.status === 'accepted'
  const account = latest.acceptedUser
  return {
    chip: { label: status.label, tone: status.tone },
    detail:
      accepted && account
        ? account.email === null
          ? account.name
          : `${account.name} · ${account.email}`
        : latest.email,
    invite: accepted ? null : '다시 초대',
    close: status.close && { kind: status.close, invitationId: latest.id },
  }
}
