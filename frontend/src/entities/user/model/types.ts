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
