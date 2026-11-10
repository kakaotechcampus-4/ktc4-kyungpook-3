import { displayValue } from '@/shared/api/unknownValue'
import { SUMMARY_STATUSES } from '@/shared/types/api/minutes'
import type { LineEditDto, MinutesDto, TitleEditDto } from '@/shared/types/api/minutes'
import { MEETING_SOURCES } from '@/shared/types/common'
import type { LineEdit, Minutes, TitleEdit } from './types'

export function toMinutes(dto: MinutesDto): Minutes {
  return {
    meetingId: dto.meeting_id,
    title: dto.title ?? '',
    titleEdited: dto.title_edited ?? false,
    titleOriginal: dto.title_edited ? (dto.title_original ?? null) : null,
    startedAt: dto.started_at,
    durationMs: dto.duration_ms,
    source: displayValue(dto.source, MEETING_SOURCES, 'minutes source'),
    attendees: dto.attendees.map((attendee) => ({
      memberId: attendee.member_id,
      displayName: attendee.display_name,
    })),
    summary: dto.summary
      ? {
          overview: dto.summary.overview,
          keyPoints: [...dto.summary.key_points],
          decisions: [...dto.summary.decisions],
        }
      : null,
    summaryStatus: displayValue(dto.summary_status, SUMMARY_STATUSES, 'minutes summary_status'),
    summaryWaitingCount: dto.summary_waiting_count,
    transcript: dto.transcript.map((line) => ({
      seq: line.seq,
      atMs: line.at_ms,
      speakerMemberId: line.speaker_member_id,
      speakerName: line.speaker_display_name ?? line.speaker_fallback,
      isFallbackName: line.speaker_display_name === null,
      text: line.text,
      edited: line.edited,
      originalText: line.edited ? line.original_text : null,
    })),
    canReview: dto.permissions.can_review,
    canUndo: dto.permissions.can_undo,
    audio: dto.audio && { contentType: dto.audio.content_type, expiresAt: dto.audio.expires_at },
  }
}

export function toTitleEdit(dto: TitleEditDto): TitleEdit {
  return {
    meetingId: dto.meeting_id,
    title: dto.title ?? '',
    titleEdited: dto.title_edited,
    titleOriginal: dto.title_edited ? dto.title_original : null,
  }
}

export function toLineEdit(dto: LineEditDto): LineEdit {
  return {
    seq: dto.seq,
    text: dto.text,
    edited: dto.edited,
    originalText: dto.edited ? dto.original_text : null,
  }
}
