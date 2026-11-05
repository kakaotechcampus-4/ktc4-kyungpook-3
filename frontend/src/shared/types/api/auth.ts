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
/* 비밀번호 재설정 (#356, 계약 §4.1.1). 세 경로 모두 로그인 없이 부른다 */
export interface PasswordResetRequestDto {
  email: string
}
export interface PasswordResetVerifyDto {
  token: string
}
export interface PasswordResetVerifiedDto {
  expires_at: string
}
export interface PasswordResetConfirmDto {
  token: string
  new_password: string
}
