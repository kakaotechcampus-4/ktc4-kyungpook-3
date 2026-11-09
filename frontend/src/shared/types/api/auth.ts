import { z } from 'zod'

/*
 * 인증 응답 스키마 (backend app/schemas/auth.py, 계약 §4.1). FE 가 읽는 필드만 본다. 타입은 이 스키마에서 만든다 (#348).
 * 요청 본문은 손으로 쓴 타입이다
 */

/** `/auth/me` 의 `user`·`PATCH /users/me` 의 응답. 카카오로 가입한 계정은 `email` 이 null 이다 (#627) */
export const userSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
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
/** 카카오 가입에 `password`·`verification_token` 이 있으면 400 이다 (#627) */
export type SignupDto =
  | { verification_token: string; password: string; name: string; username: string }
  | { link_kakao: true; name: string; username: string }
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
/** 대기 쿠키는 서명만 하고 암호화하지 않아 이메일을 담지 않는다 (#627) */
export const kakaoPendingSchema = z.object({ nickname: z.string().nullable() })
/* 아이디 (#627, 계약 §4.1.6). 중복 확인은 로그인 없이 부르고 늘 200 이다 */
export const usernameAvailabilitySchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: z.enum(['taken', 'invalid']) }),
])
export interface UsernameUpdateDto {
  username: string
}
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
