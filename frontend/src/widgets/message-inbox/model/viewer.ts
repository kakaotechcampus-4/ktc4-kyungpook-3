import type { MessageSender } from '@/entities/message'
import type { Role } from '@/shared/types/common'

/** 메시지 화면을 보는 사람. 페이지가 공간 역할을 넘기고, 아래는 이 표만 본다 */
export type MessageViewer = Role

export interface ViewerPolicy {
  /** 보내기 전 확인 영역을 보이고, 아무것도 고르지 않았으면 첫 항목을 고른다 */
  reviews: boolean
  /** 답장의 태스크를 고른다. 보내기 전 확인과 따로다 */
  attribution: boolean
  /** 오른쪽 먹 면에 그리는 보낸 쪽 */
  ownSender: MessageSender
  /** 봇 말풍선 시각 줄에 `자동 발송`·`… 승인` 을 붙인다 */
  deliveryNote: boolean
  /** 대화 아래 — PM 은 안내 바, 팀원은 답장 입력 */
  foot: 'notice' | 'reply'
}

export const VIEWER_POLICY: Record<MessageViewer, ViewerPolicy> = {
  pm: {
    reviews: true,
    attribution: true,
    ownSender: 'bot',
    deliveryNote: true,
    foot: 'notice',
  },
  member: {
    reviews: false,
    attribution: false,
    ownSender: 'member',
    deliveryNote: false,
    foot: 'reply',
  },
}
