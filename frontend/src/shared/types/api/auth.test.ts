import { db } from '@/shared/mock/db'
import { sessionFixture } from '@/shared/mock/fixtures/auth'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import {
  kakaoPendingSchema,
  passwordResetVerifiedSchema,
  sessionSchema,
  signupCodeConfirmedSchema,
  signupCodeSentSchema,
} from './auth'

describe('인증 스키마', () => {
  it.each([
    ['사용자 누락', { user: undefined }],
    ['음수 공간 수', { workspace_count: -1 }],
    ['숫자 마지막 공간', { last_workspace_id: 3 }],
  ])('세션의 %s 는 읽지 않는다', (_, patch) => {
    expect(sessionSchema.safeParse({ ...sessionFixture, ...patch }).success).toBe(false)
  })

  it('프로필 사진이 없으면 null 로 읽는다', () => {
    const user = { ...sessionFixture.user, avatar_url: null }
    expect(sessionSchema.safeParse({ ...sessionFixture, user }).success).toBe(true)
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('세션 픽스처와 로그인한 세션', async () => {
    sessionSchema.parse(sessionFixture)
    applyScenario('dashboard-default')
    sessionSchema.parse(await fetchDto('/auth/me'))
  })

  it('가입 코드 보내기·확인과 카카오 대기', async () => {
    applyScenario('signed-out')
    const email = 'new@example.com'
    signupCodeSentSchema.parse(await fetchDto('/auth/signup/code', jsonRequest('POST', { email })))
    const code = db.signupVerification.outbox.at(-1)?.code
    signupCodeConfirmedSchema.parse(
      await fetchDto('/auth/signup/code/confirm', jsonRequest('POST', { email, code })),
    )
    db.kakao.pending = { kakaoId: 'pending-kakao', email: null, nickname: '가입 대기' }
    kakaoPendingSchema.parse(await fetchDto('/auth/kakao/pending'))
  })

  it('비밀번호 재설정 링크 확인', async () => {
    applyScenario('signed-out')
    const email = db.accounts[0].session.user.email
    await fetchDto('/auth/password-reset/request', jsonRequest('POST', { email }))
    const path = db.passwordReset.outbox.at(-1)?.resetPath ?? ''
    const token = decodeURIComponent(path.split('#token=')[1])
    passwordResetVerifiedSchema.parse(
      await fetchDto('/auth/password-reset/verify', jsonRequest('POST', { token })),
    )
  })
})
