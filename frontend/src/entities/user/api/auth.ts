import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { sessionSchema } from '@/shared/types/api/auth'
import type { LoginDto, SignupDto } from '@/shared/types/api/auth'
import { toSession } from '../model/mapper'
import type { LoginInput, Session, SignupInput } from '../model/types'

/*
 * 인증 요청. 캐시 정리·이동은 여기서 하지 않는다 — 제출하는 features 가 정한다.
 * 세션은 HttpOnly 쿠키라 응답 본문에 토큰이 없다 (D-165). 응답 data 는 `/auth/me` 와 같은 모양이다.
 */

export async function login(input: LoginInput): Promise<Session> {
  const body: LoginDto = { email: input.email, password: input.password }
  return toSession(
    parseResponse(
      sessionSchema,
      await request<unknown>('/auth/login', { method: 'POST', body }),
      'user',
    ),
  )
}

/**
 * 201. 가입과 동시에 로그인된다. 409 는 이메일 가입이면 `EMAIL_ALREADY_EXISTS`·`USERNAME_TAKEN`(둘 다면 이메일 먼저),
 * 카카오 가입이면 `KAKAO_ALREADY_LINKED`·`USERNAME_TAKEN` 이다. 아이디가 규칙 밖이면 400 `INVALID_REQUEST`.
 * 증명이 없거나 만료면 400 `SIGNUP_VERIFICATION_INVALID`, 카카오 대기가 만료면 400 `KAKAO_LINK_EXPIRED`
 */
export async function signup(input: SignupInput): Promise<Session> {
  const body: SignupDto =
    input.kind === 'email'
      ? {
          verification_token: input.verificationToken,
          password: input.password,
          name: input.name,
          username: input.username,
        }
      : { link_kakao: true, name: input.name, username: input.username }
  return toSession(
    parseResponse(
      sessionSchema,
      await request<unknown>('/auth/signup', { method: 'POST', body }),
      'user',
    ),
  )
}

/** 서버 세션을 지운다. 이미 세션이 없으면 401 이다 */
export async function logout(): Promise<void> {
  await request<Record<string, never>>('/auth/logout', { method: 'POST' })
}
