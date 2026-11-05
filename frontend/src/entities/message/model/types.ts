/* 메시지 화면의 도메인 모델 (계약 §5.7). 화면은 DTO 대신 이 타입만 쓴다 */

export type MessageSender = 'bot' | 'member'

export type ReplyChannel = 'discord' | 'web'

export type DmFailureReason = 'dm_blocked' | 'discord_not_linked' | 'unknown'

/** 봇 메시지가 Discord DM 으로 나갔는가. 실패해도 웹 대화에는 남는다 */
export type DmDelivery =
  { status: 'pending' | 'claimed' | 'delivered' } | { status: 'failed'; reason: DmFailureReason }

export interface BotMessage {
  sender: 'bot'
  id: string
  body: string
  createdAt: string
  dm: DmDelivery
}

export interface MemberMessage {
  sender: 'member'
  id: string
  body: string
  createdAt: string
  replyChannel: ReplyChannel
}

export type Message = BotMessage | MemberMessage

/** 묶음 안의 태스크 하나. 태스크가 지워졌으면 제목·마감이 null 이다 */
export interface BundleTask {
  reminderId: string
  taskId: string | null
  title: string | null
  /** `YYYY-MM-DD` */
  dueDate: string | null
  note: string | null
}

export type BodySource = 'pm' | 'ai' | 'rule'

/**
 * 화면이 다루는 묶음의 단계. 응답의 status·approved 조합에서 매퍼가 한 번만 정한다.
 * 예정(`scheduled`)이 아닌 묶음은 목록·대화 응답에 오지 않는다
 */
export type BundleStage = { stage: 'awaitingApproval' } | { stage: 'approved'; approvedAt: string }

/** 보낼 메시지 — 같은 받는 사람·같은 발송 시각의 리마인드를 묶은 DM 한 통 */
export type Bundle = BundleStage & {
  id: string
  threadId: string
  memberId: string
  recipientName: string
  scheduledAt: string
  body: string
  bodySource: BodySource
  /** AI 초안이 아직 오는 중이라 문구가 바뀔 수 있다 */
  drafting: boolean
  /** 승인할 때 그대로 돌려보내는 문구의 판 */
  draftVersion: number
  tasks: BundleTask[]
}

export interface LastMessage {
  id: string
  sender: MessageSender
  body: string
  createdAt: string
}

export interface MessageThreadSummary {
  id: string
  memberId: string
  name: string
  lastMessage: LastMessage | null
  /** 답장을 기다리기 시작한 때. 서버가 정한다 — 기다리지 않으면 null */
  awaitingReplySince: string | null
  /** 그 팀원에게 마지막으로 나간 봇 메시지가 DM 으로 가지 못했다 */
  dmFailed: boolean
}

/** 목록은 보는 사람으로 갈린다. 팀원은 보낼 메시지를 받지 않는다 */
export type MessageInbox =
  | { viewer: 'pm'; bundles: Bundle[]; threads: MessageThreadSummary[] }
  | { viewer: 'member'; threads: MessageThreadSummary[] }

export interface MessageThread extends MessageThreadSummary {
  /** 시각 순 */
  messages: Message[]
  /** 이 대화의 예정 묶음. PM 에게만 오고 팀원에게는 비어 있다 */
  upcoming: Bundle[]
}

/** Discord DM 한 건의 글자 수 한도. 미리보기와 답장이 같이 쓴다 */
export const MESSAGE_BODY_MAX_LENGTH = 2000

/**
 * 메시지 쓰기 전부. 대상 ID 가 행동 안에 있다 — 어느 항목의 행동인지 따로 넘기지 않는다.
 * 모두 서버가 성공해야 화면이 바뀐다 (D-137)
 */
export type MessageAction =
  | { kind: 'approve'; bundleId: string; draftVersion: number }
  | { kind: 'cancel'; bundleId: string }
  | { kind: 'edit'; bundleId: string; body: string }
  | { kind: 'schedule'; bundleId: string; scheduledAt: string }
  | { kind: 'reply'; threadId: string; body: string }

/** 쓰기의 결과. 보낼 시각을 옮긴 자리에 같은 사람의 예정 묶음이 있으면 서버가 그 묶음(into)으로 합친다 */
export type MessageActionOutcome = { kind: 'done' } | { kind: 'merged'; into: Bundle }
