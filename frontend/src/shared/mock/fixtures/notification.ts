import type { NotificationDto, PushSubscriptionDto } from '@/shared/types/api/notification'

/** 받는 사람은 팀원 단위다. 저장 행에만 공간·팀원이 있고 응답에서는 뺀다 */
export interface MockNotification extends NotificationDto {
  workspace_id: string
  member_id: string
}

/** 푸시 구독은 로그인 계정 단위다 */
export interface MockPushSubscription extends PushSubscriptionDto {
  user_id: string
}

/**
 * ws_01 PM(mb_01)의 알림. 시나리오 notifications-default 가 넣는다 — 기본 db 는 알림이 없다.
 * 최근 순으로 무응답 막힘(tk_06), 재촉 제안(rv_01), 자동 취소(th_01), 모르는 종류, 읽은 재승인(rv_02)이다
 */
export const notificationFixtures: MockNotification[] = [
  {
    notification_id: 'nt_01',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'silence_blocked',
    text: 'STT 정확도 측정이 리마인드에 72시간 동안 응답이 없어 막힘으로 바뀌었어요.',
    link: { type: 'task', id: 'tk_06' },
    read_at: null,
    created_at: '2026-09-18T08:30:00+09:00',
  },
  {
    notification_id: 'nt_02',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'nudge_suggested',
    text: '이재환님에게 보낼 재촉을 만들었어요. 보내기 전에 확인해 주세요.',
    link: { type: 'bundle', id: 'rv_01' },
    read_at: null,
    created_at: '2026-09-18T08:00:00+09:00',
  },
  {
    notification_id: 'nt_03',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'reminder_auto_cancelled',
    text: '이재환님이 답장해 재촉 하나를 보내지 않기로 했어요.',
    link: { type: 'thread', id: 'th_01' },
    read_at: null,
    created_at: '2026-09-17T18:00:00+09:00',
  },
  {
    notification_id: 'nt_04',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'reply_judged',
    text: '정하늘님의 답장을 태스크에 반영했어요.',
    link: { type: 'reply', id: 'rp_01' },
    read_at: null,
    created_at: '2026-09-17T12:00:00+09:00',
  },
  {
    notification_id: 'nt_05',
    workspace_id: 'ws_01',
    member_id: 'mb_01',
    kind: 'nudge_reapprove',
    text: '정하늘님에게 보낼 재촉이 바뀌었어요. 다시 승인해 주세요.',
    link: { type: 'bundle', id: 'rv_02' },
    read_at: '2026-09-17T10:00:00+09:00',
    created_at: '2026-09-17T09:00:00+09:00',
  },
]
