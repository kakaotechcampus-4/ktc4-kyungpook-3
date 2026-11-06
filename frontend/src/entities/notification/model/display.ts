import { paths } from '@/shared/config/routes'
import type { NotificationLink } from './types'

/*
 * 서비스 워커도 이 파일을 가져온다. 워커에는 window 가 없으므로 API 클라이언트를 끌어오는 모듈을 여기서 가져오지 않는다
 */

const KINDS: Readonly<Record<string, { title: string; aboutMessages: boolean }>> = {
  reminder_sent: { title: '태스크 진행 상황을 물어봤어요', aboutMessages: true },
  nudge_suggested: { title: '보낼 재촉을 확인해 주세요', aboutMessages: true },
  nudge_reapprove: { title: '재촉을 다시 승인해 주세요', aboutMessages: true },
  reminder_auto_cancelled: { title: '재촉이 자동으로 취소됐어요', aboutMessages: true },
  silence_blocked: { title: '응답이 없어 태스크가 막혔어요', aboutMessages: false },
}

export const DEFAULT_NOTIFICATION_TITLE = '새 알림'

export function notificationTitle(kind: string): string {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind].title : DEFAULT_NOTIFICATION_TITLE
}

export function isMessageNotification(kind: string): boolean {
  return Object.hasOwn(KINDS, kind) && KINDS[kind].aboutMessages
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
