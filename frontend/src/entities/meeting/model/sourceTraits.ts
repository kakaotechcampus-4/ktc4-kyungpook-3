import type { MeetingSource } from '@/shared/types/common'

/**
 * 회의 안 시각(`at_ms`·`evidence_at_ms`)과 길이(`duration_ms`)를 읽는 축.
 * - `recording`: 오프셋은 녹음 안 위치, 길이는 녹음 길이다.
 * - `wall_clock`: 채팅 회의다. 오프셋은 `started_at` 에 더하면 메시지를 쓴 실제 시각이고, 길이는 첫 메시지부터 마지막 메시지까지의 기간이다.
 */
export type MeetingTimeAxis = 'recording' | 'wall_clock'

export interface MeetingSourceTraits {
  timeAxis: MeetingTimeAxis
  /** 처리 화면의 단계(음성 파일 준비하기 …)가 녹음 기준이라, 이 회의의 정리 상태를 그 화면으로 보일 수 있는지 */
  hasProcessingScreen: boolean
}

export const MEETING_SOURCE_TRAITS: Record<MeetingSource, MeetingSourceTraits> = {
  discord: { timeAxis: 'recording', hasProcessingScreen: true },
  manual_upload: { timeAxis: 'recording', hasProcessingScreen: true },
  chat: { timeAxis: 'wall_clock', hasProcessingScreen: false },
}
