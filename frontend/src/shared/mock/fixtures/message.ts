import type { MessageDto, MessageReviewDto, MessageThreadDto } from '@/shared/types/api/message'

/*
 * M8 메시지의 임시 픽스처. 계약이 아니다 (shared/types/api/message.ts). 기준 시각은 MOCK_NOW(2026-09-18 금 09:00)다.
 * 시안(Messages·MessagesThread, 기준일 9/11 금)의 날짜를 MOCK_NOW 주로 옮겼다 — 마감 9/24, 마감 하루 전 발송 9/23 09:00,
 * 이재환에게 마지막으로 보낸 날 9/16(오늘로 3일째 답장 없음), 정하늘 항목은 3일 전(9/15)에 만들어졌다.
 * ws_01: 보내기 전 확인 2건, 대화 4건(이재환은 답장 대기) + 채널 1건 (계획 C-7 `messages-default`).
 * ws_02: 대화 1건 — 공간을 바꾸면 이전 공간의 메시지가 보이지 않는지 확인한다 (AC-05)
 */

export interface MockMessageReview extends MessageReviewDto {
  workspace_id: string
}

/** 답장 대기·승인 대기는 저장하지 않는다 — handler 가 메시지와 검토 항목에서 그때그때 계산한다 */
export interface MockMessageThread extends Omit<
  MessageThreadDto,
  'awaiting_reply_since' | 'pending_reviews'
> {
  workspace_id: string
}

/** 모의 세션의 PM(최진호)이 승인했다 — 시안의 `지훈 승인` 자리 */
const PM_NAME = '최진호'

function botMessage(
  message_id: string,
  body: string,
  sent_at: string,
  approvedBy: string | null = null,
): MessageDto {
  return {
    message_id,
    sender: 'bot',
    body,
    sent_at,
    status: 'sent',
    delivery: approvedBy === null ? 'auto' : 'approved',
    approved_by: approvedBy,
  }
}

function reply(message_id: string, body: string, sent_at: string): MessageDto {
  return {
    message_id,
    sender: 'counterpart',
    body,
    sent_at,
    status: 'sent',
    delivery: null,
    approved_by: null,
  }
}

/** 실제 Discord 주소가 아니다 — 새 창에서 Discord 를 열 뿐 그 대화는 없다 */
const discordUrl = (id: string) => `https://discord.com/channels/@me/mock-${id}`

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
  },
]

export const messageThreadFixtures: MockMessageThread[] = [
  {
    thread_id: 'th_01',
    workspace_id: 'ws_01',
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
    kind: 'channel',
    name: '#회의록 요약',
    team_role: null,
    discord_url: discordUrl('th_05'),
    messages: [botMessage('mg_10', '3주차 정기회의 요약 게시', '2026-09-09T19:00:00+09:00')],
  },
  {
    thread_id: 'th_11',
    workspace_id: 'ws_02',
    kind: 'direct',
    name: '한결',
    team_role: '디자인',
    discord_url: null,
    messages: [reply('mg_21', '랜딩 시안 공유드려요', '2026-09-16T13:00:00+09:00')],
  },
]
