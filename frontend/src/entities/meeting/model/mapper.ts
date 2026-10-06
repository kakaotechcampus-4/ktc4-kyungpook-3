import type { MeetingDto, MeetingSummaryDto, MeetingUploadDto } from '@/shared/types/api/meeting'
import { enumValue } from '@/shared/lib/enum'
import type { Meeting, MeetingStatus, MeetingSummary, MeetingUploadResult } from './types'

const statuses: readonly MeetingStatus[] = ['created', 'recording', 'processing', 'done', 'failed']
export function toMeeting(dto: MeetingDto): Meeting {
  return {
    id: dto.meeting_id,
    workspaceId: dto.workspace_id,
    title: dto.title ?? '',
    status: enumValue(dto.status, statuses, 'created', 'meeting status'),
    startedAt: dto.started_at,
    endedAt: dto.ended_at,
    extractionId: dto.extraction_id,
    failedStage: dto.failed_stage,
    progress: dto.progress
      ? {
          audioMerged: dto.progress.audio_merged,
          transcribed: dto.progress.transcribed,
          extracted: dto.progress.extracted,
        }
      : null,
  }
}
export function toMeetingSummary(dto: MeetingSummaryDto): MeetingSummary {
  return {
    id: dto.meeting_id,
    title: dto.title ?? '',
    status: enumValue(dto.status, statuses, 'created', 'meeting status'),
    source: enumValue(
      dto.source,
      ['discord', 'manual_upload'] as const,
      'discord',
      'meeting source',
    ),
    startedAt: dto.started_at,
    durationMs: dto.duration_ms,
    attendeeCount: dto.attendee_count,
    processedAt: dto.processed_at,
  }
}
export function toMeetingUploadResult(dto: MeetingUploadDto): MeetingUploadResult {
  return {
    id: dto.meeting_id,
    status: enumValue(dto.status, statuses, 'processing', 'meeting status'),
  }
}
