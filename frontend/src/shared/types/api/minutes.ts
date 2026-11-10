import { z } from 'zod'

/*
 * 회의록 본문 스키마 (backend MeetingMinutesResponse, api/meetings.py get_meeting_minutes). FE 가 읽는 필드만 본다.
 * 타입은 이 스키마에서 만든다 (#348)
 */

/** 요약 상태 (계약 §4.4.2). `pending` 은 아직 만들고 있고 `none` 은 쓸 수 있는 요약이 없다 */
export const SUMMARY_STATUSES = ['ready', 'pending', 'none'] as const
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number]

const minutesSummarySchema = z.object({
  overview: z.string(),
  key_points: z.array(z.string()),
  decisions: z.array(z.string()),
})

export const minutesSchema = z.object({
  meeting_id: z.string(),
  // 서버 Meeting.title 이 nullable 이다
  title: z.string().nullable(),
  // 고친 표시와 처음 제목은 표시용이라 모양이 틀리면 표시만 버린다. 키가 없는 이전 서버는 고친 적 없는 회의다 (§4.4.3)
  title_edited: z.boolean().optional().catch(undefined),
  title_original: z.string().nullable().optional().catch(undefined),
  started_at: z.string(),
  duration_ms: z.number(),
  // 표시용 분류라 모르는 값은 mapper 가 `알 수 없는 출처` 로 남긴다
  source: z.string(),
  attendees: z.array(z.object({ member_id: z.string(), display_name: z.string() })),
  // 서버가 저장된 JSON 을 그대로 내리고 깨진 요약은 없는 것으로 본다. 모양이 틀린 요약도 같게 없는 것으로 보고 전사문은 보인다.
  summary: minutesSummarySchema.nullable().catch(({ input }) => {
    if (import.meta.env.DEV) console.warn('Invalid minutes summary:', input)
    return null
  }),
  // 빈 요약에 어떤 문구를 보일지만 고르는 표시용 값이라 응답을 거절하지 않는다. 키가 없는 이전 서버는 `none` 이다
  summary_status: z.string().default('none').catch('none'),
  transcript: z.array(
    z.object({
      // 줄 고치기 경로의 번호다. 없거나 틀리면 그 줄만 고칠 수 없고 글은 그대로 보인다 (§4.4.3)
      seq: z.number().int().nonnegative().nullable().catch(null),
      at_ms: z.number(),
      speaker_member_id: z.string().nullable(),
      speaker_display_name: z.string().nullable(),
      speaker_fallback: z.string(),
      text: z.string(),
      edited: z.boolean().catch(false),
      original_text: z.string().nullable().catch(null),
    }),
  ),
  // 검토·되돌리기 권한이라 모양이 틀리면 응답 전체가 `INVALID_RESPONSE` 다
  permissions: z.object({ can_review: z.boolean(), can_undo: z.boolean() }),
})
export type MinutesDto = z.infer<typeof minutesSchema>

/* 회의 기록 고치기 응답 (backend schemas/record_edit.py, 계약 §4.4.3). 캐시에 그대로 넣는 값은 모양이 틀리면 응답 전체를 읽지 못한 것이다 */

export const titleEditSchema = z.object({
  meeting_id: z.string(),
  title: z.string().nullable(),
  title_original: z.string().nullable().catch(null),
  title_edited: z.boolean().catch(false),
})
export type TitleEditDto = z.infer<typeof titleEditSchema>

export const lineEditSchema = z.object({
  seq: z.number().int().nonnegative(),
  text: z.string(),
  original_text: z.string().nullable().catch(null),
  edited: z.boolean().catch(false),
})
export type LineEditDto = z.infer<typeof lineEditSchema>
