import type { MessageSender } from '@/entities/message'
import type { Role } from '@/shared/types/common'

/** 메시지 화면을 보는 사람. 페이지가 공간 역할과 팀원 행을 넘긴다 */
export interface MessageViewer {
  role: Role
  /** 이 공간에서 보는 사람의 팀원 행. 없으면 null */
  memberId: string | null
}

/** 메시지 목록 맨 위, PM 이 리마인드를 받은 자기 대화의 구역 이름 (#417) */
export const SELF_SECTION_TITLE = '내 리마인드'

/** 대화 하나를 그리는 규칙. 보는 사람의 역할과 그 대화의 주인이 고른다 */
export interface ThreadPolicy {
  /** 오른쪽 먹 면에 그리는 보낸 쪽 */
  ownSender: MessageSender
  /** 답장 기다림(머리 배지·목록 점·`여기서부터 답장이 없습니다`·`답장 기다리는 중 N`)을 보인다 */
  awaiting: boolean
  /** 리마인드를 받은 대화 위에 이 기기의 알림을 켜자는 띠를 보인다 (#411) */
  pushPrompt: boolean
  /** AI 가 정하지 못한 답장의 태스크를 고른다. 서버도 PM 만 받는다 */
  pickTask: boolean
  /** 웹 답장 칸을 둔다. 서버는 대화 주인의 답장만 받는다(계약 §5.7) */
  reply: boolean
  /** 목록에서 대화 행이 놓이는 구역 */
  section: 'self' | 'threads'
}

type Audience = 'pm' | 'pmSelf' | 'member'

const THREAD_POLICY: Record<Audience, ThreadPolicy> = {
  pm: {
    ownSender: 'bot',
    awaiting: true,
    pushPrompt: false,
    pickTask: true,
    reply: false,
    section: 'threads',
  },
  // PM 이 리마인드를 받은 자기 대화는 팀원 화면처럼 그린다. PM 권한(태스크 고르기)은 그대로다
  pmSelf: {
    ownSender: 'member',
    awaiting: false,
    pushPrompt: true,
    pickTask: true,
    reply: true,
    section: 'self',
  },
  member: {
    ownSender: 'member',
    awaiting: false,
    pushPrompt: true,
    pickTask: false,
    reply: true,
    section: 'threads',
  },
}

/**
 * 팀원이 여는 대화는 모두 자기 대화라 팀원 행을 몰라도 된다.
 * PM 은 팀원 행이 그 대화의 주인일 때만 자기 대화다 — 팀원 행이 없으면(옛 백엔드) 모두 남의 대화로 본다
 */
export function threadPolicy(viewer: MessageViewer, threadMemberId: string): ThreadPolicy {
  if (viewer.role === 'member') return THREAD_POLICY.member
  return THREAD_POLICY[viewer.memberId === threadMemberId ? 'pmSelf' : 'pm']
}
