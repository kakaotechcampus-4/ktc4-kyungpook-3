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

/**
 * 누구의 화면으로 그리는가.
 * - pm: PM 이 남의 대화를 본다
 * - pmSelf: PM 이 리마인드를 받은 자기 대화를 본다 — 팀원 화면처럼 그린다
 * - member: 팀원이 자기 대화를 본다
 */
export type Audience = 'pm' | 'pmSelf' | 'member'

/** 대화 하나를 그리는 규칙. 보는 사람의 역할과 그 대화의 주인이 고른다 */
export interface ThreadPolicy {
  audience: Audience
  /** 보는 사람의 팀원 행. PM 글이 내 글인지 가른다 */
  viewerMemberId: string | null
  /** 답장 기다림(머리 배지·목록 점·`여기서부터 답장이 없습니다`·`답장 기다리는 중 N`)을 보인다 */
  awaiting: boolean
  /** 리마인드를 받은 대화 위에 이 기기의 알림을 켜자는 띠를 보인다 (#411) */
  pushPrompt: boolean
  /** AI 가 정하지 못한 답장의 태스크를 고른다. 서버도 PM 만 받는다 */
  pickTask: boolean
  /** 목록에서 대화 행이 놓이는 구역 */
  section: 'self' | 'threads'
}

const THREAD_POLICY: Record<Audience, Omit<ThreadPolicy, 'audience' | 'viewerMemberId'>> = {
  pm: { awaiting: true, pushPrompt: false, pickTask: true, section: 'threads' },
  // PM 권한(태스크 고르기)은 자기 대화에서도 그대로다
  pmSelf: { awaiting: false, pushPrompt: true, pickTask: true, section: 'self' },
  member: { awaiting: false, pushPrompt: true, pickTask: false, section: 'threads' },
}

/**
 * 보낸 쪽마다 말풍선이 오른쪽(내 글)인가. author 는 그 PM 글을 보는 사람이 썼을 때만 내 글이다.
 * PM 이 남의 대화를 보면 봇 메시지도 PM 쪽 글이라 오른쪽이다. 아직 나가지 않은 묶음도 봇 자리를 따른다
 */
const OWN_SIDE: Record<Audience, Record<MessageSender, 'own' | 'other' | 'author'>> = {
  pm: { bot: 'own', pm: 'author', member: 'other' },
  pmSelf: { bot: 'other', pm: 'other', member: 'own' },
  member: { bot: 'other', pm: 'other', member: 'own' },
}

/** 누가 쓴 글인가. 작성자는 PM 글만 갖는다 */
export interface Authorship {
  sender: MessageSender
  authorMemberId?: string | null
}

/** 말풍선 자리와 목록의 `나:` 가 함께 쓴다 — 둘이 어긋나지 않는다. 팀원 행을 모르면 어느 PM 글도 내 글이 아니다 */
export function isOwnMessage(policy: ThreadPolicy, message: Authorship): boolean {
  const side = OWN_SIDE[policy.audience][message.sender]
  if (side !== 'author') return side === 'own'
  return policy.viewerMemberId !== null && message.authorMemberId === policy.viewerMemberId
}

/**
 * 팀원이 여는 대화는 모두 자기 대화라 팀원 행을 몰라도 된다.
 * PM 은 팀원 행이 그 대화의 주인일 때만 자기 대화다 — 팀원 행이 없으면(옛 백엔드) 모두 남의 대화로 본다
 */
export function threadPolicy(viewer: MessageViewer, threadMemberId: string): ThreadPolicy {
  const audience: Audience =
    viewer.role === 'member' ? 'member' : viewer.memberId === threadMemberId ? 'pmSelf' : 'pm'
  return { audience, viewerMemberId: viewer.memberId, ...THREAD_POLICY[audience] }
}
