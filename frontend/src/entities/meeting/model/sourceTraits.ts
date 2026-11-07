import type { MeetingSource } from '@/shared/types/common'

/**
 * 회의 안 시각(`at_ms`·`evidence_at_ms`)과 길이(`duration_ms`)를 읽는 축.
 * - `recording`: 오프셋은 녹음 안 위치, 길이는 녹음 길이다.
 * - `wall_clock`: 채팅 회의다. 오프셋은 `started_at` 에 더하면 메시지를 쓴 실제 시각이고, 길이는 첫 메시지부터 마지막 메시지까지의 기간이다.
 */
export type MeetingTimeAxis = 'recording' | 'wall_clock'

export interface MeetingSourceTraits {
  timeAxis: MeetingTimeAxis
  /**
   * 회의록 목록의 정리 중 행을 처리 화면으로 잇는지. 채팅 회의는 처리 화면 단계가 녹음 기준이던 때(#379) 막았다.
   * 채팅 두 단계(#483)가 생긴 뒤에도 목록에서 다시 잇는 것은 정하지 않았다 — 진행 토스트의 「자세히 보기」는 잇는다
   */
  hasProcessingScreen: boolean
}

export const MEETING_SOURCE_TRAITS: Record<MeetingSource, MeetingSourceTraits> = {
  discord: { timeAxis: 'recording', hasProcessingScreen: true },
  manual_upload: { timeAxis: 'recording', hasProcessingScreen: true },
  chat: { timeAxis: 'wall_clock', hasProcessingScreen: false },
}
