export interface UserDto {
  user_id: string
  email: string
  name: string
  avatar_url: string | null
}
export interface SessionDto {
  user: UserDto
  workspace_count: number
  last_workspace_id: string | null
}
export interface LoginDto {
  email: string
  password: string
}
export interface SignupDto extends LoginDto {
  name: string
}
/* 가입 이메일 인증과 카카오 로그인 (#427, 계약 §4.1.2). 모두 로그인 없이 부른다 */
export interface SignupCodeRequestDto {
  email: string
}
export interface SignupCodeSentDto {
  expires_in: number
  resend_after: number
}
export interface SignupCodeConfirmDto {
  email: string
  code: string
}
export interface SignupCodeConfirmedDto {
  verification_token: string
  expires_in: number
}
export interface KakaoPendingDto {
  /** 카카오가 인증한 이메일. 없거나 인증되지 않았으면 null */
  email: string | null
  nickname: string | null
}
/* 비밀번호 재설정 (#356, 계약 §4.1.1). 세 경로 모두 로그인 없이 부른다 */
export interface PasswordResetRequestDto {
  email: string
}
export interface PasswordResetVerifyDto {
  token: string
}
export interface PasswordResetVerifiedDto {
  expires_at: string
  /** 아이디 앞 2자(2자 이하면 1자) + `***`, 도메인은 그대로. 예: `ab***@gmail.com` */
  email_masked: string
}
export interface PasswordResetConfirmDto {
  token: string
  new_password: string
}
