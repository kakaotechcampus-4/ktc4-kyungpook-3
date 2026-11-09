import { displayValue } from '@/shared/api/unknownValue'
import { SUMMARY_STATUSES } from '@/shared/types/api/minutes'
import type { MinutesDto } from '@/shared/types/api/minutes'
import { MEETING_SOURCES } from '@/shared/types/common'
import type { Minutes } from './types'

export function toMinutes(dto: MinutesDto): Minutes {
  return {
    meetingId: dto.meeting_id,
    title: dto.title ?? '',
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
    transcript: dto.transcript.map((line) => ({
      atMs: line.at_ms,
      speakerMemberId: line.speaker_member_id,
      speakerName: line.speaker_display_name ?? line.speaker_fallback,
      isFallbackName: line.speaker_display_name === null,
      text: line.text,
    })),
    canReview: dto.permissions.can_review,
    canUndo: dto.permissions.can_undo,
  }
}
