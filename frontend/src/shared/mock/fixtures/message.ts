import type { MessageReviewDto, MessageThreadDto } from '@/shared/types/api/message'

/*
 * M8 메시지의 임시 픽스처. 계약이 아니다 (shared/types/api/message.ts). 기준 시각은 MOCK_NOW(2026-09-18 금 09:00)다.
 * 시안(Messages·MessagesThread, 기준일 9/11 금)의 날짜를 MOCK_NOW 주로 옮겼다 — 마감 9/24, 마감 하루 전 발송 9/23 09:00,
 * 이재환에게 마지막으로 보낸 날 9/16(오늘로 3일째 답장 없음), 정하늘 항목은 3일 전(9/15)에 만들어졌다.
 * 재촉은 검토 행 하나로 승인 대기·예약·발송·취소·만료를 지난다. 만료는 마감일로 읽을 때 계산하고 저장하지 않는다.
 * ws_01: 보내기 전 확인 2건(rv_01·rv_02). rv_03 은 취소됨, rv_04 는 만료라 목록에 없다.
 * 대화 4건(이재환은 답장 대기) + 채널 1건 (계획 C-7 `messages-default`).
 * ws_02: 대화 1건 — 공간을 바꾸면 이전 공간의 메시지가 보이지 않는지 확인한다 (AC-05)
 */

export interface MockMessageReview extends Omit<
  MessageReviewDto,
  'status' | 'approved_by' | 'deadline_send_passed'
> {
  workspace_id: string
  /** 만료는 여기 없다. 마감이 지난 승인 대기를 읽을 때 만료로 본다 */
  state: 'pending' | 'approved' | 'sent' | 'cancelled'
  approved_by: string | null
  cancel_reason: 'dismissed' | 'responded' | null
  /** 나간 시각, 또는 취소된 기록을 놓는 시각 */
  closed_at: string | null
}

export type MockAttribution =
  | { status: 'needs_pm'; candidate_task_ids: string[] }
  | { status: 'resolved'; task_id: string | null }

/** 대화에 이미 쌓인 메시지. 재촉의 단계는 검토 행이 가진다 */
export interface MockThreadMessage {
  message_id: string
  sender: 'bot' | 'member'
  body: string
  sent_at: string
  approved_by: string | null
  source: 'discord' | 'web' | null
  attribution: MockAttribution | null
}

/** 답장 대기·재촉의 단계는 저장하지 않는다 — handler 가 메시지와 검토 항목에서 그때그때 계산한다 */
export interface MockMessageThread extends Omit<
  MessageThreadDto,
  'awaiting_reply_since' | 'messages'
> {
  workspace_id: string
  /** 이 대화의 팀원. 채널이거나 팀원에 없으면 null */
  member_id: string | null
  messages: MockThreadMessage[]
}

/** 모의 세션의 PM(최진호)이 승인했다 — 시안의 `지훈 승인` 자리 */
const PM_NAME = '최진호'

export function botMessage(
  message_id: string,
  body: string,
  sent_at: string,
  approvedBy: string | null = null,
): MockThreadMessage {
  return {
    message_id,
    sender: 'bot',
    body,
    sent_at,
    approved_by: approvedBy,
    source: null,
    attribution: null,
  }
}

export function reply(
  message_id: string,
  body: string,
  sent_at: string,
  source: 'discord' | 'web' = 'discord',
): MockThreadMessage {
  return {
    message_id,
    sender: 'member',
    body,
    sent_at,
    approved_by: null,
    source,
    attribution: null,
  }
}

/** 실제 Discord 주소가 아니다 — 새 창에서 Discord 를 열 뿐 그 대화는 없다 */
const discordUrl = (id: string) => `https://discord.com/channels/@me/mock-${id}`

const open = {
  state: 'pending',
  approved_by: null,
  cancel_reason: null,
  closed_at: null,
} as const

export const messageReviewFixtures: MockMessageReview[] = [
  {
    review_id: 'rv_01',
    workspace_id: 'ws_01',
    thread_id: 'th_01',
    recipient_name: '이재환',
    summary: 'API 명세서 진행 상황을 물어보는 DM',
    body: '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!',
    created_at: '2026-09-17T18:00:00+09:00',
    deadline: '2026-09-24',
    reason: 'API 명세서 마감이 9/24인데, 9/16 이후로 #개발 채널에 진행 소식이 없어요.',
    reason_url: discordUrl('dev-last'),
    send_timing: 'day_before_deadline',
    scheduled_at: '2026-09-23T09:00:00+09:00',
    deadline_send_at: '2026-09-23T09:00:00+09:00',
    ...open,
  },
  {
    review_id: 'rv_02',
    workspace_id: 'ws_01',
    thread_id: 'th_03',
    recipient_name: '정하늘',
    summary: '퍼블리싱 진행 상황 확인',
    body: '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏',
    created_at: '2026-09-15T10:00:00+09:00',
    deadline: null,
    reason: '퍼블리싱 태스크가 9/4 이후로 「진행 중」에서 바뀌지 않았어요.',
    reason_url: null,
    send_timing: 'now',
    scheduled_at: null,
    deadline_send_at: null,
    ...open,
  },
  {
    review_id: 'rv_03',
    workspace_id: 'ws_01',
    thread_id: 'th_03',
    recipient_name: '정하늘',
    summary: '발표 자료 진행 확인',
    body: '하늘님, 발표 자료는 어디까지 됐나요?',
    created_at: '2026-09-07T09:00:00+09:00',
    deadline: null,
    reason: '발표 자료 태스크에 9/8 오전까지 소식이 없어 묻기로 했다가, 보내기 전에 답이 왔어요.',
    reason_url: null,
    send_timing: 'custom',
    scheduled_at: '2026-09-08T09:00:00+09:00',
    deadline_send_at: null,
    state: 'cancelled',
    approved_by: null,
    cancel_reason: 'responded',
    closed_at: '2026-09-08T09:00:00+09:00',
  },
  {
    review_id: 'rv_04',
    workspace_id: 'ws_01',
    thread_id: 'th_04',
    recipient_name: '박지훈',
    summary: '회의록 템플릿 검토 확인',
    body: '지훈님, 회의록 템플릿 검토는 끝나셨나요?',
    created_at: '2026-09-09T10:00:00+09:00',
    deadline: '2026-09-10',
    reason: '회의록 템플릿 마감이 9/10인데, 그 전에 보내지 못했어요.',
    reason_url: null,
    send_timing: 'day_before_deadline',
    scheduled_at: '2026-09-09T18:00:00+09:00',
    deadline_send_at: '2026-09-09T18:00:00+09:00',
    ...open,
  },
]

/** 기본 목록에 넣지 않는다. `messages-schedule-passed` 만 더한다. 마감은 오늘이라 만료가 아니다 */
export const schedulePassedReview: MockMessageReview = {
  review_id: 'rv_06',
  workspace_id: 'ws_01',
  thread_id: 'th_01',
  recipient_name: '이재환',
  summary: '지난 예약 재촉',
  body: '재환님, 어제 보내려던 확인이 아직 나가지 않았어요.',
  created_at: '2026-09-17T09:00:00+09:00',
  deadline: '2026-09-18',
  reason: '마감 하루 전 시각이 지났는데, 재촉 자동 승인이 꺼져 있어 나가지 않았어요.',
  reason_url: null,
  send_timing: 'day_before_deadline',
  scheduled_at: '2026-09-17T09:00:00+09:00',
  deadline_send_at: '2026-09-17T09:00:00+09:00',
  ...open,
}

export const messageThreadFixtures: MockMessageThread[] = [
  {
    thread_id: 'th_01',
    workspace_id: 'ws_01',
    member_id: 'mb_03',
    kind: 'direct',
    name: '이재환',
    team_role: '백엔드',
    discord_url: discordUrl('th_01'),
    messages: [
      botMessage(
        'mg_01',
        '재환님, 3주차 회의에서 API 명세서를 9/24까지 정리해 주신다고 하셨어요.\nNotion 태스크로 올려 뒀습니다 🙂',
        '2026-09-15T09:02:00+09:00',
      ),
      reply(
        'mg_02',
        '네 확인했습니다. DB 스키마 확정되면 바로 붙일게요.',
        '2026-09-15T09:31:00+09:00',
      ),
      botMessage(
        'mg_03',
        'DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?',
        '2026-09-16T18:00:00+09:00',
        PM_NAME,
      ),
    ],
  },
  {
    thread_id: 'th_02',
    workspace_id: 'ws_01',
    member_id: 'mb_02',
    kind: 'direct',
    name: '박민수',
    team_role: 'AI',
    discord_url: discordUrl('th_02'),
    messages: [
      botMessage('mg_04', '민수님, STT 튜닝은 어떻게 되고 있나요?', '2026-09-09T10:00:00+09:00'),
      reply('mg_05', 'STT 튜닝 결과 Notion에 붙였습니다', '2026-09-09T14:20:00+09:00'),
    ],
  },
  {
    thread_id: 'th_03',
    workspace_id: 'ws_01',
    member_id: 'mb_04',
    kind: 'direct',
    name: '정하늘',
    team_role: '프론트엔드',
    discord_url: discordUrl('th_03'),
    messages: [
      botMessage(
        'mg_06',
        '하늘님, 발표 순서를 정해 주실 수 있을까요?',
        '2026-09-04T11:00:00+09:00',
        PM_NAME,
      ),
      reply('mg_07', '발표 순서 정리해서 올릴게요', '2026-09-04T11:12:00+09:00'),
    ],
  },
  {
    thread_id: 'th_04',
    workspace_id: 'ws_01',
    member_id: null,
    kind: 'direct',
    name: '박지훈',
    team_role: '디자인',
    discord_url: discordUrl('th_04'),
    messages: [
      botMessage(
        'mg_08',
        '지훈님, 회의록 템플릿을 Notion에 올려 뒀어요.',
        '2026-09-02T15:00:00+09:00',
      ),
      reply('mg_09', '확인했습니다', '2026-09-02T15:40:00+09:00'),
    ],
  },
  {
    thread_id: 'th_05',
    workspace_id: 'ws_01',
    member_id: null,
    kind: 'channel',
    name: '#회의록 요약',
    team_role: null,
    discord_url: discordUrl('th_05'),
    messages: [botMessage('mg_10', '3주차 정기회의 요약 게시', '2026-09-09T19:00:00+09:00')],
  },
  {
    thread_id: 'th_11',
    workspace_id: 'ws_02',
    member_id: null,
    kind: 'direct',
    name: '한결',
    team_role: '디자인',
    discord_url: null,
    messages: [reply('mg_21', '랜딩 시안 공유드려요', '2026-09-16T13:00:00+09:00')],
  },
]
