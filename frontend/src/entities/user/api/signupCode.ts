import { config } from '@/shared/config/env'
import { devPaths } from '@/shared/config/routes'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import {
  kakaoPendingSchema,
  signupCodeConfirmedSchema,
  signupCodeSentSchema,
} from '@/shared/types/api/auth'
import type { SignupCodeConfirmDto, SignupCodeRequestDto } from '@/shared/types/api/auth'
import type { KakaoPending } from '../model/types'

/*
 * 가입 이메일 인증과 카카오 로그인 요청 (#427, 계약 §4.1.2). 로그인 없이 부른다.
 * 가입에 쓰는 이메일은 서버가 증명 토큰이나 카카오 쿠키에서 읽는다. 화면이 이메일을 보내 가입하는 길은 없다.
 */

/** 메일을 보낸다. 다시 보낼 수 있을 때까지 남은 초를 돌려준다 */
export async function requestSignupCode(email: string): Promise<{ resendAfter: number }> {
  const body: SignupCodeRequestDto = { email }
  const data = parseResponse(
    signupCodeSentSchema,
    await request<unknown>('/auth/signup/code', { method: 'POST', body }),
    'user',
  )
  return { resendAfter: data.resend_after }
}

/** 맞으면 가입에 쓸 증명 토큰을 돌려준다. 코드가 틀리면 400 `SIGNUP_CODE_INVALID` (signupCodeProblem) */
export async function confirmSignupCode(input: { email: string; code: string }): Promise<string> {
  const body: SignupCodeConfirmDto = input
  const data = parseResponse(
    signupCodeConfirmedSchema,
    await request<unknown>('/auth/signup/code/confirm', { method: 'POST', body }),
    'user',
  )
  return data.verification_token
}

/** 카카오 동의를 마치고 가입을 기다리는 신원. 쿠키가 없거나 만료면 400 `KAKAO_LINK_EXPIRED` */
export async function fetchKakaoPending(): Promise<KakaoPending> {
  return parseResponse(kakaoPendingSchema, await request<unknown>('/auth/kakao/pending'), 'user')
}

/** 카카오 로그인을 시작하는 주소. 현재 탭을 옮긴다. `next` 는 로그인 뒤 돌아갈 앱 안 경로다 */
export function kakaoStartUrl(next: string | undefined): string {
  const query = next === undefined ? '' : `?${new URLSearchParams({ next }).toString()}`
  // DEV 를 먼저 본다 — 번들러가 이 분기를 지워야 프로덕션 번들에 모의 경로가 남지 않는다
  if (import.meta.env.DEV && config.mswEnabled) return `${devPaths.mockKakao()}${query}`
  return `${config.apiBaseUrl}/auth/kakao/start${query}`
}
