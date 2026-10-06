import { z } from 'zod'
import { isDateOnly } from '@/shared/lib/date'

/* 검증 안내 (D-085, D-087). 캔버스에 오류 문구가 없어 D-149 에 맞춰 이 기능에서 정한다 */
export const UPLOAD_FORM_MESSAGES = {
  fileRequired: '정리할 녹음 파일을 골라 주세요.',
  titleRequired: '회의 제목을 입력해 주세요.',
  dateRequired: '회의 날짜를 골라 주세요.',
  attendeesRequired: '참석자를 한 명 이상 골라 주세요.',
} as const

/** 파일은 폼 값이 아니다 — 검사가 비동기라 따로 상태로 둔다. 제목은 앞뒤 공백을 지우고 본다 */
export const meetingUploadSchema = z.object({
  title: z.string().trim().min(1, UPLOAD_FORM_MESSAGES.titleRequired),
  date: z.string().refine(isDateOnly, UPLOAD_FORM_MESSAGES.dateRequired),
  attendeeMemberIds: z.array(z.string()).min(1, UPLOAD_FORM_MESSAGES.attendeesRequired),
})
export type MeetingUploadValues = z.infer<typeof meetingUploadSchema>
