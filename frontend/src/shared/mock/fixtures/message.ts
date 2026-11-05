import type {
  BundleDto,
  DmFailureReasonDto,
  MessageDto,
  ReminderDto,
} from '@/shared/types/api/message'

/*
 * 메시지 픽스처 (계약 §5.7 모양). 기준 시각은 MOCK_NOW(2026-09-18 금 09:00)다. 시각은 읽기 쉽게 +09:00 으로 두고
 * handler 가 응답할 때 서버처럼 UTC 로 바꾼다.
 * ws_01: 보낼 메시지 2통(이재환 bd_01 은 마감 하루 전, 정하늘 bd_02 는 직접 정한 시각이고 AI 초안을 기다린다).
 * 대화 4건 — 이재환은 3일째 답장이 없고, 박지훈에게 마지막으로 보낸 DM 은 서버 DM 이 막혀 가지 못했다 (계획 C-7 `messages-default`).
 * ws_02: 대화 1건 — 공간을 바꾸면 이전 공간의 메시지가 보이지 않는지 확인한다 (AC-05)
 */

/** 대화에 쌓인 메시지. thread_id 는 담긴 대화가 정한다 */
export type MockThreadMessage = Omit<MessageDto, 'thread_id'>

export interface MockMessageThread {
  thread_id: string
  workspace_id: string
  member_id: string
  name: string
  messages: MockThreadMessage[]
}

/** 보낼 메시지. 리마인드는 묶음과 함께 저장하고, 응답에는 묶음과 같은 상태인 것만 싣는다 */
export interface MockBundle extends Omit<BundleDto, 'reminders'> {
  workspace_id: string
  reminders: ReminderDto[]
}

type DmResult =
  { status: 'pending' | 'claimed' | 'delivered' } | { status: 'failed'; reason: DmFailureReasonDto }

const DELIVERED: DmResult = { status: 'delivered' }

export function botMessage(
  message_id: string,
  body: string,
  created_at: string,
  dm: DmResult = DELIVERED,
): MockThreadMessage {
  return {
    message_id,
    sender: 'bot',
    body,
    created_at,
    reply_channel: null,
    dm_status: dm.status,
    dm_failure_reason: dm.status === 'failed' ? dm.reason : null,
    scheduled_at: created_at,
  }
}

export function reply(
  message_id: string,
  body: string,
  created_at: string,
  channel: 'discord' | 'web' = 'discord',
): MockThreadMessage {
  return {
    message_id,
    sender: 'member',
    body,
    created_at,
    reply_channel: channel,
    dm_status: null,
    dm_failure_reason: null,
    scheduled_at: null,
  }
}

function reminder(
  reminder_id: string,
  bundle_id: string,
  task: { task_id: string; title: string; due_date: string | null },
  note: string | null = null,
): ReminderDto {
  return {
    reminder_id,
    bundle_id,
    task_id: task.task_id,
    task_title: task.title,
    due_date: task.due_date,
    note,
    status: 'scheduled',
    kind: 'nudge',
    origin: 'scheduler',
    created_at: '2026-09-15T09:00:00+09:00',
  }
}

const waiting = {
  status: 'scheduled',
  approved: false,
  approved_at: null,
} as const

export const messageBundleFixtures: MockBundle[] = [
  {
    bundle_id: 'bd_01',
    workspace_id: 'ws_01',
    thread_id: 'th_01',
    member_id: 'mb_03',
    recipient_name: '이재환',
    scheduled_at: '2026-09-23T09:00:00+09:00',
    ...waiting,
    body: '재환님, API 명세서 마감이 다음 주 목요일(9/24)이에요 🙂\n혹시 막히는 부분 있으면 알려주세요. 필요하면 마감을 옮겨도 괜찮아요!',
    body_source: 'ai',
    draft_status: 'done',
    draft_version: 2,
    reminders: [
      reminder('rm_01', 'bd_01', { task_id: 'tk_01', title: 'API 명세서', due_date: '2026-09-24' }),
    ],
  },
  {
    bundle_id: 'bd_02',
    workspace_id: 'ws_01',
    thread_id: 'th_03',
    member_id: 'mb_04',
    recipient_name: '정하늘',
    scheduled_at: '2026-09-25T14:00:00+09:00',
    ...waiting,
    body: "하늘님, 최진호예요.\n'퍼블리싱' 외 1건 진행 상황을 한번 여쭤봐요.\n지금 어디까지 됐는지 편하게 알려 주세요!",
    body_source: 'rule',
    draft_status: 'needed',
    draft_version: 1,
    reminders: [
      reminder(
        'rm_02',
        'bd_02',
        { task_id: 'tk_04', title: '퍼블리싱', due_date: null },
        '시안 2차 반영분까지',
      ),
      reminder('rm_03', 'bd_02', { task_id: 'tk_06', title: '발표 자료', due_date: '2026-09-30' }),
    ],
  },
]

/** 기본 목록에 넣지 않는다. `messages-schedule-passed` 만 더한다. 승인하지 않은 채 시각이 지나 예정으로 남았다 */
export const schedulePassedBundle: MockBundle = {
  bundle_id: 'bd_06',
  workspace_id: 'ws_01',
  thread_id: 'th_01',
  member_id: 'mb_03',
  recipient_name: '이재환',
  scheduled_at: '2026-09-17T09:00:00+09:00',
  ...waiting,
  body: '재환님, 어제 보내려던 확인이 아직 나가지 않았어요.',
  body_source: 'ai',
  draft_status: 'done',
  draft_version: 1,
  reminders: [
    reminder('rm_06', 'bd_06', {
      task_id: 'tk_07',
      title: '배포 체크리스트',
      due_date: '2026-09-18',
    }),
  ],
}

export const messageThreadFixtures: MockMessageThread[] = [
  {
    thread_id: 'th_01',
    workspace_id: 'ws_01',
    member_id: 'mb_03',
    name: '이재환',
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
      ),
    ],
  },
  {
    thread_id: 'th_02',
    workspace_id: 'ws_01',
    member_id: 'mb_02',
    name: '박민수',
    messages: [
      botMessage(
        'mg_04',
        '민수님, 회원가입 화면과 회의록 요약 검수는 어떻게 되고 있나요?',
        '2026-09-09T10:00:00+09:00',
      ),
      reply('mg_05', '거의 다 됐어요. 내일 오전에 올릴게요', '2026-09-09T14:20:00+09:00'),
    ],
  },
  {
    thread_id: 'th_03',
    workspace_id: 'ws_01',
    member_id: 'mb_04',
    name: '정하늘',
    messages: [
      botMessage(
        'mg_06',
        '하늘님, 발표 순서를 정해 주실 수 있을까요?',
        '2026-09-04T11:00:00+09:00',
      ),
      reply('mg_07', '발표 순서 정리해서 올릴게요', '2026-09-04T11:12:00+09:00'),
    ],
  },
  {
    thread_id: 'th_04',
    workspace_id: 'ws_01',
    member_id: 'mb_05',
    name: '박지훈',
    messages: [
      botMessage('mg_08', '지훈님, 회의록 템플릿 검토는 끝나셨나요?', '2026-09-02T15:00:00+09:00', {
        status: 'failed',
        reason: 'dm_blocked',
      }),
    ],
  },
  {
    thread_id: 'th_11',
    workspace_id: 'ws_02',
    member_id: 'mb_21',
    name: '한결',
    messages: [reply('mg_21', '랜딩 시안 공유드려요', '2026-09-16T13:00:00+09:00')],
  },
]

/**
 * 기본 목록에 넣지 않는다. `messages-member` 만 더한다.
 * 세션 팀원(mb_01)의 대화라 그 사람만 본다. 마지막 봇 메시지는 Discord 가 연결되지 않아 DM 으로 가지 못했다
 */
export const messagesMemberThread: MockMessageThread = {
  thread_id: 'th_06',
  workspace_id: 'ws_01',
  member_id: 'mb_01',
  name: '김서연',
  messages: [
    botMessage('mg_11', '서연님, 이번 주 할 일을 정리해 뒀어요.', '2026-09-15T09:00:00+09:00'),
    botMessage('mg_12', '서연님, 명세서는 시작하셨나요?', '2026-09-16T18:00:00+09:00'),
    reply('mg_13', '디스코드에서 답했어요', '2026-09-16T19:00:00+09:00'),
    reply('mg_14', '웹에서 남긴 답장이에요', '2026-09-17T14:20:00+09:00', 'web'),
    botMessage('mg_15', '서연님, 오늘 남은 확인만 부탁드려요.', '2026-09-17T18:00:00+09:00', {
      status: 'failed',
      reason: 'discord_not_linked',
    }),
  ],
}

/** th_06 에 매달린 보낼 메시지. 팀원에게는 오지 않는다 */
export const messagesMemberBundle: MockBundle = {
  bundle_id: 'bd_05',
  workspace_id: 'ws_01',
  thread_id: 'th_06',
  member_id: 'mb_01',
  recipient_name: '김서연',
  scheduled_at: '2026-09-23T09:00:00+09:00',
  ...waiting,
  body: '서연님, 이 재촉은 보내기 전 확인에만 있어요.',
  body_source: 'ai',
  draft_status: 'done',
  draft_version: 1,
  reminders: [
    reminder('rm_05', 'bd_05', { task_id: 'tk_03', title: '기획서', due_date: '2026-09-24' }),
  ],
}
