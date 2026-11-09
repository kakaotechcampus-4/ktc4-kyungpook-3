export interface User {
  id: string
  /** 소문자로 저장한 아이디. 모든 계정에 있다 (#627) */
  username: string
  /** 카카오로 가입한 계정은 없다 */
  email: string | null
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
/**
 * 회원가입 요청 (#627). 이메일 가입은 코드 확인이 준 증명으로 이메일을 정하고 비밀번호를 둔다.
 * 카카오 가입은 대기 쿠키의 카카오 신원만으로 만들고 이메일·비밀번호가 없다. `username` 은 정규화한 값이다
 */
export type SignupInput =
  | { kind: 'email'; verificationToken: string; password: string; name: string; username: string }
  | { kind: 'kakao'; name: string; username: string }
/** 카카오 동의를 마치고 가입을 기다리는 신원. 이름 칸을 닉네임으로 채운다 */
export interface KakaoPending {
  nickname: string | null
}
