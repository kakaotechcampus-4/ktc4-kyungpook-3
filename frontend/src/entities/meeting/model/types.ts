import type { MeetingSource } from '@/shared/types/common'
export type { MeetingSource } from '@/shared/types/common'
export type MeetingStatus = 'created' | 'recording' | 'processing' | 'done' | 'failed'
export interface MeetingSummary {
  id: string
  title: string
  status: MeetingStatus
  source: MeetingSource
  startedAt: string
  durationMs: number | null
  attendeeCount: number
  processedAt: string | null
}
export interface MeetingProgress {
  audioMerged: boolean
  transcribed: boolean
  extracted: boolean
}
export interface Meeting {
  id: string
  workspaceId: string
  title: string
  status: MeetingStatus
  startedAt: string
  endedAt: string | null
  extractionId: string | null
  failedStage: string | null
  progress: MeetingProgress | null
}
