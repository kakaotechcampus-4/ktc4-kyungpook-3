export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}
export interface Session {
  user: User
  workspaceCount: number
  lastWorkspaceId: string | null
}
/** 로그인 요청. 백엔드 LoginRequest 그대로다 */
export interface LoginInput {
  email: string
  password: string
}
/** 회원가입 요청. 백엔드 SignupRequest 그대로다 */
export interface SignupInput extends LoginInput {
  name: string
}
/** 카카오 동의를 마치고 가입을 기다리는 신원. 이메일은 카카오가 인증했을 때만 있다 */
export interface KakaoPending {
  email: string | null
  nickname: string | null
}
