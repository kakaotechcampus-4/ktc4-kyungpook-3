import { z } from 'zod'

/*
 * 초대 응답 스키마 (backend app/schemas/invitation.py, 계약 §5.9). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348)
 */

/**
 * 초대 상태. 팀 화면의 연결 표시와 초대·취소·연결 끊기 버튼을 정해 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다.
 * 전에는 닫힌 초대(취소)로 읽어 다시 초대하라고 했다
 */
export const invitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'canceled',
  'revoked',
])

/** PM 이 보는 초대 한 건. accepted_user 는 연결을 끊은 뒤에도 남고, 계정이 지워지면 null 이다 */
export const invitationSchema = z.object({
  invitation_id: z.string(),
  member_id: z.string(),
  email: z.string(),
  status: invitationStatusSchema,
  accepted_user: z.object({ user_id: z.string(), name: z.string(), email: z.string() }).nullable(),
  created_at: z.string(),
})
export type InvitationDto = z.infer<typeof invitationSchema>

export const invitationListSchema = z.object({ items: z.array(invitationSchema) })

/** 내 가입 이메일로 온 대기 중 초대 */
export const myInvitationSchema = z.object({
  invitation_id: z.string(),
  workspace_id: z.string(),
  workspace_name: z.string(),
  member_display_name: z.string(),
  invited_by_name: z.string().nullable(),
})
export type MyInvitationDto = z.infer<typeof myInvitationSchema>

export const myInvitationListSchema = z.object({ items: z.array(myInvitationSchema) })

/** 요청 본문. 서버가 이메일을 소문자로 바꿔 저장한다 */
export interface InvitationCreateDto {
  member_id: string
  email: string
}
