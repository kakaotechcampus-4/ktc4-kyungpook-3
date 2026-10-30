import type { MessageReviewDto, MessageThreadDto } from '@/shared/types/api/message'

/*
 * M8 메시지의 임시 픽스처. 계약이 아니다 (shared/types/api/message.ts). 기준 시각은 MOCK_NOW(2026-09-18 금 09:00)다.
 * ws_01: 보내기 전 확인 2건, 대화 4건(이재환은 봇이 마지막으로 보내 답장 대기) + 채널 1건 (계획 C-7 `messages-default`).
 * ws_02: 대화 1건 — 공간을 바꾸면 이전 공간의 메시지가 보이지 않는지 확인한다 (AC-05)
 */

export interface MockMessageReview extends MessageReviewDto {
  workspace_id: string
}

export interface MockMessageThread extends MessageThreadDto {
  workspace_id: string
}

export const messageReviewFixtures: MockMessageReview[] = [
  {
    review_id: 'rv_01',
    workspace_id: 'ws_01',
    recipient_name: '이재환',
    summary: 'API 명세서 진행 상황을 물어보는 DM',
    body: '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!',
    created_at: '2026-09-17T18:00:00+09:00',
  },
  {
    review_id: 'rv_02',
    workspace_id: 'ws_01',
    recipient_name: '정하늘',
    summary: '퍼블리싱 진행 상황 확인',
    body: '하늘님, 퍼블리싱은 어디까지 진행됐는지 알려주실 수 있을까요? 🙏',
    created_at: '2026-09-15T10:00:00+09:00',
  },
]

export const messageThreadFixtures: MockMessageThread[] = [
  {
    thread_id: 'th_01',
    workspace_id: 'ws_01',
    kind: 'direct',
    name: '이재환',
    messages: [
      {
        message_id: 'mg_01',
        sender: 'bot',
        body: '재환님, 3주차 회의에서 API 명세서를 9/24까지 정리해 주신다고 하셨어요.\nNotion 태스크로 올려 뒀습니다 🙂',
        sent_at: '2026-09-08T09:02:00+09:00',
      },
      {
        message_id: 'mg_02',
        sender: 'counterpart',
        body: '네 확인했습니다. DB 스키마 확정되면 바로 붙일게요.',
        sent_at: '2026-09-08T09:31:00+09:00',
      },
      {
        message_id: 'mg_03',
        sender: 'bot',
        body: 'DB 스키마가 확정됐다고 들었어요. 명세서 작업은 시작하셨나요?',
        sent_at: '2026-09-10T18:00:00+09:00',
      },
    ],
  },
  {
    thread_id: 'th_02',
    workspace_id: 'ws_01',
    kind: 'direct',
    name: '박민수',
    messages: [
      {
        message_id: 'mg_04',
        sender: 'bot',
        body: '민수님, STT 튜닝은 어떻게 되고 있나요?',
        sent_at: '2026-09-09T10:00:00+09:00',
      },
      {
        message_id: 'mg_05',
        sender: 'counterpart',
        body: 'STT 튜닝 결과 Notion에 붙였습니다',
        sent_at: '2026-09-09T14:20:00+09:00',
      },
    ],
  },
  {
    thread_id: 'th_03',
    workspace_id: 'ws_01',
    kind: 'direct',
    name: '정하늘',
    messages: [
      {
        message_id: 'mg_06',
        sender: 'bot',
        body: '하늘님, 발표 순서를 정해 주실 수 있을까요?',
        sent_at: '2026-09-04T11:00:00+09:00',
      },
      {
        message_id: 'mg_07',
        sender: 'counterpart',
        body: '발표 순서 정리해서 올릴게요',
        sent_at: '2026-09-04T11:12:00+09:00',
      },
    ],
  },
  {
    thread_id: 'th_04',
    workspace_id: 'ws_01',
    kind: 'direct',
    name: '박지훈',
    messages: [
      {
        message_id: 'mg_08',
        sender: 'bot',
        body: '지훈님, 회의록 템플릿을 Notion에 올려 뒀어요.',
        sent_at: '2026-09-02T15:00:00+09:00',
      },
      {
        message_id: 'mg_09',
        sender: 'counterpart',
        body: '확인했습니다',
        sent_at: '2026-09-02T15:40:00+09:00',
      },
    ],
  },
  {
    thread_id: 'th_05',
    workspace_id: 'ws_01',
    kind: 'channel',
    name: '#회의록 요약',
    messages: [
      {
        message_id: 'mg_10',
        sender: 'bot',
        body: '3주차 정기회의 요약 게시',
        sent_at: '2026-09-09T19:00:00+09:00',
      },
    ],
  },
  {
    thread_id: 'th_11',
    workspace_id: 'ws_02',
    kind: 'direct',
    name: '한결',
    messages: [
      {
        message_id: 'mg_21',
        sender: 'counterpart',
        body: '랜딩 시안 공유드려요',
        sent_at: '2026-09-16T13:00:00+09:00',
      },
    ],
  },
]
