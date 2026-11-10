import { z } from 'zod'

/*
 * 인증 응답 스키마 (backend app/schemas/auth.py, 계약 §4.1). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348).
 * 요청 본문은 손으로 쓴 타입이다
 */

const userSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
})
export type UserDto = z.infer<typeof userSchema>

/** `GET /auth/me`·로그인·가입의 응답 */
export const sessionSchema = z.object({
  user: userSchema,
  workspace_count: z.number().int().nonnegative(),
  last_workspace_id: z.string().nullable(),
})
export type SessionDto = z.infer<typeof sessionSchema>

export interface LoginDto {
  email: string
  password: string
}
export interface SignupDto {
  verification_token?: string
  password: string
  name: string
  link_kakao: boolean
}
/* 가입 이메일 인증과 카카오 로그인 (#427, 계약 §4.1.2). 모두 로그인 없이 부른다 */
export interface SignupCodeRequestDto {
  email: string
}
/** 다시 보낼 수 있을 때까지 남은 초 */
export const signupCodeSentSchema = z.object({ resend_after: z.number().int().nonnegative() })
export interface SignupCodeConfirmDto {
  email: string
  code: string
}
export const signupCodeConfirmedSchema = z.object({ verification_token: z.string() })
export type SignupCodeConfirmedDto = z.infer<typeof signupCodeConfirmedSchema>
export const kakaoPendingSchema = z.object({
  /** 카카오가 인증한 이메일. 없거나 인증되지 않았으면 null */
  email: z.string().nullable(),
  nickname: z.string().nullable(),
})
/* 비밀번호 재설정 (#356, 계약 §4.1.1). 세 경로 모두 로그인 없이 부른다 */
export interface PasswordResetRequestDto {
  email: string
}
export interface PasswordResetVerifyDto {
  token: string
}
export const passwordResetVerifiedSchema = z.object({
  expires_at: z.string(),
  /** 아이디 앞 2자(2자 이하면 1자) + `***`, 도메인은 그대로. 예: `ab***@gmail.com` */
  email_masked: z.string(),
})
export interface PasswordResetConfirmDto {
  token: string
  new_password: string
}
