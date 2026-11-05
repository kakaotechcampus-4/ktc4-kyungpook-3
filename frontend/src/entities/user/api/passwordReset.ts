import { request } from '@/shared/api/client'
import type {
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetVerifiedDto,
  PasswordResetVerifyDto,
} from '@/shared/types/api/auth'

/*
 * 비밀번호 재설정 요청 (#356, 계약 §4.1.1). 로그인 없이 부른다.
 * 토큰은 본문으로만 보낸다 — 주소에 실으면 서버 접근 로그와 Referer 에 남는다.
 */

/** 가입하지 않은 이메일, 60초 안의 재요청, 1시간 5회 초과도 같은 200 이라 메일이 갔는지는 알 수 없다 */
export async function requestPasswordReset(email: string): Promise<void> {
  const body: PasswordResetRequestDto = { email }
  await request<Record<string, never>>('/auth/password-reset/request', { method: 'POST', body })
}

/** 쓸 수 있는 링크면 만료 시각을 돌려준다. 못 쓰면 400 `PASSWORD_RESET_TOKEN_INVALID` (resetLinkProblem) */
export async function verifyPasswordReset(token: string): Promise<{ expiresAt: string }> {
  const body: PasswordResetVerifyDto = { token }
  const data = await request<PasswordResetVerifiedDto>('/auth/password-reset/verify', {
    method: 'POST',
    body,
  })
  return { expiresAt: data.expires_at }
}

/** 성공하면 서버가 그 계정의 세션을 모두 끊는다. 자동 로그인은 없다 */
export async function confirmPasswordReset(input: {
  token: string
  newPassword: string
}): Promise<void> {
  const body: PasswordResetConfirmDto = { token: input.token, new_password: input.newPassword }
  await request<Record<string, never>>('/auth/password-reset/confirm', { method: 'POST', body })
}
