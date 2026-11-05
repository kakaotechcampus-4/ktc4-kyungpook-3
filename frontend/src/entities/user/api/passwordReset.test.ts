import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequestBodies } from '@/shared/test/requests'
import { resetLinkProblem } from '../model/passwordReset'
import { confirmPasswordReset, requestPasswordReset, verifyPasswordReset } from './passwordReset'

/* 요청 모양과 응답 매핑. 상태 전이는 shared/mock/passwordReset.test.ts 가 본다 */

beforeEach(() => {
  applyScenario('password-reset')
})

describe('비밀번호 재설정 요청', () => {
  it('요청은 { email } 을 보내고 값을 돌려주지 않는다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/password-reset/request')
    await expect(requestPasswordReset('pm@example.com')).resolves.toBeUndefined()
    await vi.waitFor(() => expect(bodies).toEqual([{ email: 'pm@example.com' }]))
  })

  it('확인은 { token } 을 보내고 만료 시각을 돌려준다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/password-reset/verify')
    await expect(verifyPasswordReset('mock-reset-normal')).resolves.toEqual({
      expiresAt: db.passwordReset.tokens[0].expiresAt,
    })
    await vi.waitFor(() => expect(bodies).toEqual([{ token: 'mock-reset-normal' }]))
  })

  it('변경은 { token, new_password } 를 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/auth/password-reset/confirm')
    await expect(
      confirmPasswordReset({ token: 'mock-reset-normal', newPassword: 'newpass123' }),
    ).resolves.toBeUndefined()
    await vi.waitFor(() =>
      expect(bodies).toEqual([{ token: 'mock-reset-normal', new_password: 'newpass123' }]),
    )
  })

  it('쓸 수 없는 링크의 실패는 resetLinkProblem 으로 까닭을 읽는다', async () => {
    applyScenario('password-reset-used')
    const error = await verifyPasswordReset('mock-reset-used').catch((caught: unknown) => caught)
    expect(resetLinkProblem(error)).toBe('used')
  })
})
