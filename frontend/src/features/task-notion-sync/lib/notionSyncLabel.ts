import type { NotionSyncStatus } from '@/entities/task'

/** 반영 중인 태스크를 다시 조회하는 간격 (계획 §4-8) */
export const NOTION_SYNC_POLL_MS = 3_000

/**
 * Notion 반영 문구. 서버의 `notion_sync_status` 만 따른다 (계획 §4-7).
 * 승인 성공이나 `notion_page_id` 존재로 `반영됨` 을 쓰지 않는다 — `synced` 일 때만이다
 */
export function notionSyncLabel(status: NotionSyncStatus | null): string {
  if (status === 'pending') return '반영 중'
  if (status === 'synced') return '반영됨'
  if (status === 'failed') return '반영 실패'
  return '반영 상태 없음'
}
