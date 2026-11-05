import type { MessageSender } from '@/entities/message'
import type { Role } from '@/shared/types/common'

/** 메시지 화면을 보는 사람. 페이지가 공간 역할을 넘기고, 아래는 이 표만 본다 */
export type MessageViewer = Role

export interface ViewerPolicy {
  /** 오른쪽 먹 면에 그리는 보낸 쪽 */
  ownSender: MessageSender
  /**
   * 대화 아래 — PM 은 안내 바, 팀원은 답장 입력. 답장은 대화 주인만 할 수 있다(계약 §5.7).
   * 팀원이 여는 대화는 모두 자기 대화이고, PM 은 남의 대화를 본다
   */
  foot: 'notice' | 'reply'
  /** 답장 기다림(머리 배지·목록 점·`여기서부터 답장이 없습니다`)을 보인다 */
  awaiting: boolean
  /** 재촉을 만든다(`새 재촉`). 서버도 PM 만 받는다 */
  compose: boolean
}

export const VIEWER_POLICY: Record<MessageViewer, ViewerPolicy> = {
  pm: { ownSender: 'bot', foot: 'notice', awaiting: true, compose: true },
  member: { ownSender: 'member', foot: 'reply', awaiting: false, compose: false },
}
