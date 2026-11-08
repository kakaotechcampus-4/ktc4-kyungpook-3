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
/** 회원가입 요청. 백엔드 SignupRequest 그대로다. 이메일은 없다 — 증명 토큰이나 카카오 쿠키의 값으로만 만든다 */
export interface SignupInput {
  /** 코드 확인이 준 증명. 카카오가 인증한 이메일로 가입할 때는 null 이다 */
  verificationToken: string | null
  name: string
  password: string
  /** 가입하며 대기 중인 카카오 계정을 잇는다 */
  linkKakao: boolean
}
/** 카카오 동의를 마치고 가입을 기다리는 신원. 이메일은 카카오가 인증했을 때만 있다 */
export interface KakaoPending {
  email: string | null
  nickname: string | null
}
