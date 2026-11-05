import type { Task, TaskHistoryEntry } from '../model/types'

/**
 * 무응답 자동 막힘인가. 막힌 태스크의 마지막 상태 변경이 스케줄러일 때만 참이다 — 막힘 사유 문구로 가르지 않는다.
 * 같은 시각이면 앞의 것이 마지막이다. 서버가 이력을 최신 순으로 준다
 */
export function isAutoBlocked(
  task: Pick<Task, 'status'>,
  history: readonly TaskHistoryEntry[],
): boolean {
  if (task.status !== 'blocked') return false
  let latest: TaskHistoryEntry | undefined
  for (const entry of history) {
    if (entry.field !== 'status') continue
    if (latest === undefined || Date.parse(entry.createdAt) > Date.parse(latest.createdAt))
      latest = entry
  }
  return latest?.source === 'scheduler'
}
