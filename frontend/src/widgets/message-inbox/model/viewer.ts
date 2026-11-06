import type { MessageSender } from '@/entities/message'
import type { Role } from '@/shared/types/common'

/** 메시지 화면을 보는 사람. 페이지가 공간 역할과 팀원 행을 넘긴다 */
export interface MessageViewer {
  role: Role
  /** 이 공간에서 보는 사람의 팀원 행. 없으면 null */
  memberId: string | null
}

export interface ViewerPolicy {
  /** 오른쪽 먹 면에 그리는 보낸 쪽 */
  ownSender: MessageSender
  /** 답장 기다림(머리 배지·목록 점·`여기서부터 답장이 없습니다`)을 보인다 */
  awaiting: boolean
  /** 재촉을 만든다(`새 재촉`). 서버도 PM 만 받는다 */
  compose: boolean
  /** 리마인드를 받은 대화 위에 이 기기의 알림을 켜자는 띠를 보인다 (#411). 리마인드는 팀원이 받는다 */
  pushPrompt: boolean
  /** AI 가 정하지 못한 답장의 태스크를 고른다. 서버도 PM 만 받는다 */
  pickTask: boolean
}

export const VIEWER_POLICY: Record<Role, ViewerPolicy> = {
  pm: { ownSender: 'bot', awaiting: true, compose: true, pushPrompt: false, pickTask: true },
  member: {
    ownSender: 'member',
    awaiting: false,
    compose: false,
    pushPrompt: true,
    pickTask: false,
  },
}

/**
 * 웹 답장은 대화 주인만 한다(계약 §5.7). 팀원이 여는 대화는 모두 자기 대화라 팀원 행을 몰라도 답장 칸을 둔다.
 * PM 은 팀원 행이 그 대화의 주인일 때만이다 — 팀원 행이 없거나(옛 백엔드) 남의 대화면 서버가 403 이다
 */
export function canReply(viewer: MessageViewer, threadMemberId: string): boolean {
  return viewer.role === 'member' || viewer.memberId === threadMemberId
}
