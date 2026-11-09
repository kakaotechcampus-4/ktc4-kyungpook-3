import { db } from './db'
import { requireAuth, requireMember } from './auth-guard'
import { fail } from './envelope'

export interface MockMeetingDeletion {
  meeting_id: string
  workspace_id: string
  deleted_at: string
  cleanup_status: 'pending' | 'complete'
  deleted_meeting_ids: string[]
}

export function deletedMeetingResponse(meetingId: string) {
  const unauthenticated = requireAuth()
  if (unauthenticated) return unauthenticated
  const deleted = db.meetingDeletions.find(({ meeting_id }) => meeting_id === meetingId)
  if (!deleted) return null
  return requireMember(deleted.workspace_id) ?? fail('MEETING_DELETED', '삭제된 회의입니다.', 410)
}

export function purgeMeeting(meetingId: string): void {
  db.meetings = db.meetings.filter(({ meeting_id }) => meeting_id !== meetingId)
  db.meetingSummaries = db.meetingSummaries.filter(({ meeting_id }) => meeting_id !== meetingId)
  db.minutes = db.minutes.filter(({ meeting_id }) => meeting_id !== meetingId)
  db.extractions = db.extractions.filter(({ meeting_id }) => meeting_id !== meetingId)
  db.approvals = db.approvals.filter(({ payload }) => payload.meeting_id !== meetingId)
  delete db.meetingFlow.attendees[meetingId]
  delete db.meetingFlow.speakers[meetingId]
}
