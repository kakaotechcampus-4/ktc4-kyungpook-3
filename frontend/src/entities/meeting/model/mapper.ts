import { displayValue, fallbackValue } from '@/shared/api/unknownValue'
import type {
  MeetingDto,
  MeetingSummaryDto,
  MeetingUploadDto,
  SpeakerViewDto,
} from '@/shared/types/api/meeting'
import { MEETING_SOURCES } from '@/shared/types/common'
import { PROCESSING_STAGES } from './types'
import type {
  Meeting,
  MeetingProcessing,
  MeetingSummary,
  MeetingUploadResult,
  SpeakerView,
} from './types'

/** 스키마를 통과한 응답만 받는다. 모르는 회의 상태는 이미 `INVALID_RESPONSE` 로 걸렀다 */
export function toMeeting(dto: MeetingDto): Meeting {
  return {
    id: dto.meeting_id,
    workspaceId: dto.workspace_id,
    title: dto.title ?? '',
    status: dto.status,
    startedAt: dto.started_at,
    endedAt: dto.ended_at,
    extractionId: dto.extraction_id,
    failedStage: dto.failed_stage,
    deletionAvailable: dto.deletion_available === true,
    progress: dto.progress
      ? {
          audioMerged: dto.progress.audio_merged,
          transcribed: dto.progress.transcribed,
          extracted: dto.progress.extracted,
        }
      : null,
    processing: dto.processing ? toMeetingProcessing(dto.processing) : null,
  }
}
function toMeetingProcessing(dto: NonNullable<MeetingDto['processing']>): MeetingProcessing {
  return {
    stage:
      dto.stage === null
        ? null
        : fallbackValue(dto.stage, PROCESSING_STAGES, null, 'processing stage'),
    stageAt: dto.stage_at,
    stt: dto.stt && { done: dto.stt.done, total: dto.stt.total },
  }
}
export function toMeetingSummary(dto: MeetingSummaryDto): MeetingSummary {
  return {
    id: dto.meeting_id,
    title: dto.title ?? '',
    status: dto.status,
    source: displayValue(dto.source, MEETING_SOURCES, 'meeting source'),
    startedAt: dto.started_at,
    durationMs: dto.duration_ms,
    attendeeCount: dto.attendee_count,
    processedAt: dto.processed_at,
    failedStage: dto.failed_stage ?? null,
  }
}
export function toMeetingUploadResult(dto: MeetingUploadDto): MeetingUploadResult {
  return { id: dto.meeting_id, status: dto.status }
}
export function toSpeakerView(dto: SpeakerViewDto): SpeakerView {
  return {
    meetingId: dto.meeting_id,
    status: dto.status,
    speakers: dto.speakers.map(({ label, total_sec, samples }) => ({
      label,
      totalSec: total_sec,
      samples: samples.map(({ start, end }) => ({ start, end })),
    })),
    candidates: dto.candidates.map(({ member_id, display_name }) => ({
      memberId: member_id,
      displayName: display_name,
    })),
    mapping: dto.mapping,
    audio: dto.audio && {
      contentType: dto.audio.content_type,
      sizeBytes: dto.audio.size_bytes,
    },
  }
}
