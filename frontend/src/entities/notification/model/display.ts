import { paths } from '@/shared/config/routes'
import type { NotificationLink } from './types'

/*
 * 서비스 워커도 이 파일을 가져온다. 워커에는 window 가 없으므로 API 클라이언트를 끌어오는 모듈을 여기서 가져오지 않는다
 */

/** 알림이 알리는 서버 쪽 변화가 바꾼 캐시. 종이 처음 보는 알림이면 그 공간의 이 캐시들을 다시 받는다 */
export type NotificationRefresh = 'messages' | 'tasks' | 'approvals'

const KINDS: Readonly<
  Record<string, { title: string; refreshes: readonly NotificationRefresh[] }>
> = {
  reminder_sent: { title: '태스크 진행 상황을 물어봤어요', refreshes: ['messages'] },
  nudge_suggested: { title: '보낼 재촉을 확인해 주세요', refreshes: ['messages'] },
  nudge_reapprove: { title: '재촉을 다시 승인해 주세요', refreshes: ['messages'] },
  reminder_auto_cancelled: { title: '재촉이 자동으로 취소됐어요', refreshes: ['messages'] },
  silence_blocked: { title: '응답이 없어 태스크가 막혔어요', refreshes: ['tasks'] },
  // 판단은 태스크를 바꾸고 승인 요청을 만든 뒤에 알린다. 대화에는 답장이 들어왔고 고를 답장이 바뀌었을 수 있다
  reply_judged: {
    title: '팀원 답장을 판단했어요',
    refreshes: ['messages', 'tasks', 'approvals'],
  },
  // 판단하지 못한 답장도 응답이라 BE 가 막힘을 풀 수 있다
  reply_unjudged: { title: '답장을 자동으로 판단하지 못했어요', refreshes: ['messages', 'tasks'] },
  // PM 글은 대화 주인에게, 팀원 글은 PM 들에게 온다
  message_received: { title: '새 메시지가 왔어요', refreshes: ['messages'] },
}

const NO_REFRESH: readonly NotificationRefresh[] = []

export const DEFAULT_NOTIFICATION_TITLE = '새 알림'

export function notificationTitle(kind: string): string {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind].title : DEFAULT_NOTIFICATION_TITLE
}

/** 모르는 종류는 아무것도 다시 받지 않는다 */
export function notificationRefreshes(kind: string): readonly NotificationRefresh[] {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind].refreshes : NO_REFRESH
}

/**
 * 링크 종류마다 갈 곳. 묶음(bundle)은 id 로 가는 경로가 없어 메시지 화면의 보내기 전 확인 항목(`?review=`)으로 보낸다
 */
const LINK_PATHS: Readonly<
  Record<Exclude<NotificationLink['type'], 'unknown'>, (workspaceId: string, id: string) => string>
> = {
  thread: paths.messageThread,
  bundle: paths.messageReview,
  task: (workspaceId, id) => paths.tasks(workspaceId, id),
}

/** 누르면 갈 경로. 모르는 링크는 null 이다 — 읽음만 표시하고 옮기지 않는다 */
export function notificationPath(workspaceId: string, link: NotificationLink): string | null {
  return link.type === 'unknown' ? null : LINK_PATHS[link.type](workspaceId, link.id)
}
