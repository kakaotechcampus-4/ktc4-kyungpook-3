import type { MeetingSource } from '@/shared/types/common'

/**
 * 회의 안 시각(`at_ms`·`evidence_at_ms`)과 길이(`duration_ms`)를 읽는 축.
 * - `recording`: 오프셋은 녹음 안 위치, 길이는 녹음 길이다.
 * - `wall_clock`: 채팅 회의다. 오프셋은 `started_at` 에 더하면 메시지를 쓴 실제 시각이고, 길이는 첫 메시지부터 마지막 메시지까지의 기간이다.
 */
export type MeetingTimeAxis = 'recording' | 'wall_clock'

export interface MeetingSourceTraits {
  timeAxis: MeetingTimeAxis
}

export const MEETING_SOURCE_TRAITS: Record<MeetingSource, MeetingSourceTraits> = {
  discord: { timeAxis: 'recording' },
  manual_upload: { timeAxis: 'recording' },
  chat: { timeAxis: 'wall_clock' },
}
