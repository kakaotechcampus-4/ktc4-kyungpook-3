import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { lineEditSchema, titleEditSchema } from '@/shared/types/api/minutes'
import { toLineEdit, toTitleEdit } from '../model/mapper'
import type { LineEdit, TitleEdit } from '../model/types'

/** 회의 제목을 고친다. null 이면 처음 제목으로 되돌린다 (계약 §4.4.3) */
export async function editMeetingTitle(
  meetingId: string,
  title: string | null,
  signal?: AbortSignal,
): Promise<TitleEdit> {
  return toTitleEdit(
    parseResponse(
      titleEditSchema,
      await request<unknown>(`/meetings/${encodeURIComponent(meetingId)}/title`, {
        method: 'PATCH',
        body: { title },
        signal,
      }),
      'meeting title',
    ),
  )
}

/** 발화 한 줄을 고친다. null 이면 원문으로 되돌린다 (계약 §4.4.3) */
export async function editTranscriptLine(
  meetingId: string,
  seq: number,
  text: string | null,
  signal?: AbortSignal,
): Promise<LineEdit> {
  return toLineEdit(
    parseResponse(
      lineEditSchema,
      await request<unknown>(
        `/meetings/${encodeURIComponent(meetingId)}/transcript/${encodeURIComponent(seq)}`,
        { method: 'PATCH', body: { text }, signal },
      ),
      'transcript line',
    ),
  )
}
