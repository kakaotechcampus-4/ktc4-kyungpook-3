import { request } from '@/shared/api/client'
import type { LoginDto, SessionDto, SignupDto } from '@/shared/types/api/auth'
import { toSession } from '../model/mapper'
import type { LoginInput, Session, SignupInput } from '../model/types'

/*
 * 인증 요청. 캐시 정리·이동은 여기서 하지 않는다 — 제출하는 features 가 정한다.
 * 세션은 HttpOnly 쿠키라 응답 본문에 토큰이 없다 (D-165). 응답 data 는 `/auth/me` 와 같은 모양이다.
 */

export async function login(input: LoginInput): Promise<Session> {
  const body: LoginDto = { email: input.email, password: input.password }
  return toSession(await request<SessionDto>('/auth/login', { method: 'POST', body }))
}

/** 201. 가입과 동시에 로그인된다. 이미 있는 이메일은 409 `EMAIL_ALREADY_EXISTS` */
export async function signup(input: SignupInput): Promise<Session> {
  const body: SignupDto = { email: input.email, password: input.password, name: input.name }
  return toSession(await request<SessionDto>('/auth/signup', { method: 'POST', body }))
}

/** 서버 세션을 지운다. 이미 세션이 없으면 401 이다 */
export async function logout(): Promise<void> {
  await request<Record<string, never>>('/auth/logout', { method: 'POST' })
}
