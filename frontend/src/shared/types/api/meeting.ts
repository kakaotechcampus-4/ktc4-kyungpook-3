import { z } from 'zod'

/*
 * 회의 응답 스키마 (backend app/schemas/meeting.py·upload.py, api/workspaces.py 목록). FE 가 읽는 필드만 본다.
 * 타입은 이 스키마에서 만든다 (#348)
 */

/** 서버 MeetingStatus. 처리 추적·회의록·업로드 차단을 정하므로 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다 */
export const meetingStatusSchema = z.enum([
  'created',
  'recording',
  'processing',
  'awaiting_speakers',
  'done',
  'failed',
])

/** 목록 한 줄. 서버 `items` 가 `list[dict]` 라 BE 스키마에 드러나지 않는다 (계약 §4.0-②-14) */
export const meetingSummarySchema = z.object({
  meeting_id: z.string(),
  title: z.string().nullable(),
  status: meetingStatusSchema,
  // discord | manual_upload | chat. 표시용 분류라 모르는 값은 mapper 가 `알 수 없는 출처` 로 남긴다
  source: z.string(),
  started_at: z.string(),
  duration_ms: z.number().nullable(),
  attendee_count: z.number(),
  processed_at: z.string().nullable(),
  // 표시용 문자열이다. 실패 안내는 아는 값만 골라 읽고 모르는 값은 기본 문구다
  failed_stage: z.string().nullish(),
})
export type MeetingSummaryDto = z.infer<typeof meetingSummarySchema>

export const meetingListSchema = z.object({ items: z.array(meetingSummarySchema) })

export const meetingSchema = z.object({
  meeting_id: z.string(),
  workspace_id: z.string(),
  title: z.string().nullable(),
  status: meetingStatusSchema,
  started_at: z.string(),
  ended_at: z.string().nullable(),
  extraction_id: z.string().nullable(),
  failed_stage: z.string().nullable(),
  // #576 전 서버는 없다. 없으면 지울 수 없는 것으로 본다
  deletion_available: z.boolean().optional(),
  // 서버는 늘 준다. 없는 옛 응답은 모든 단계가 아직이다
  progress: z
    .object({ audio_merged: z.boolean(), transcribed: z.boolean(), extracted: z.boolean() })
    .nullish(),
  // #542 전 서버는 없다. 없으면 녹음 회의 단계를 `progress` 만으로 세 단계로 그릴 수 있어, 모양이 틀리면 응답을 거절하지 않고
  // 없는 것으로 본다(D-184). 정리 중일 때만 객체다
  processing: z
    .object({
      stage: z.string().nullable(),
      stage_at: z.string().nullable(),
      stt: z
        .object({ done: z.number().int().min(0), total: z.number().int().min(1) })
        .refine(({ done, total }) => done <= total)
        .nullable(),
    })
    .nullish()
    .catch(({ input }) => {
      if (import.meta.env.DEV) console.warn('Invalid meeting processing:', input)
      return null
    }),
})
export type MeetingDto = z.infer<typeof meetingSchema>

/** 업로드 202 응답 */
export const meetingUploadResponseSchema = z.object({
  meeting_id: z.string(),
  status: meetingStatusSchema,
})
export type MeetingUploadDto = z.infer<typeof meetingUploadResponseSchema>

function isSpeakerMapping(value: unknown): value is Record<string, string | null> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((member) => member === null || typeof member === 'string')
  )
}

/** 화자 지정 화면 (backend SpeakerViewResponse) */
export const speakerViewSchema = z.object({
  meeting_id: z.string(),
  status: meetingStatusSchema,
  speakers: z.array(
    z.object({
      label: z.string(),
      total_sec: z.number(),
      samples: z.array(z.object({ start: z.number(), end: z.number() })),
    }),
  ),
  candidates: z.array(z.object({ member_id: z.string(), display_name: z.string() })),
  // 라벨 → 팀원 ID(외부 참석자는 null). `z.record` 는 초기 chunk 에 `ZodRecord` 를 들여 같은 검사를 직접 쓴다
  mapping: z.custom<Record<string, string | null>>(isSpeakerMapping).nullable(),
  audio: z.object({ content_type: z.string(), size_bytes: z.number() }).nullable(),
})
export type SpeakerViewDto = z.infer<typeof speakerViewSchema>
