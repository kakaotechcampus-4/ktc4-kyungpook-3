import {
  AUTH_MESSAGES,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupCodeSchema,
  signupEmailSchema,
  signupProfileSchema,
} from './schemas'

function issues(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return (result.error?.issues ?? []).map(({ path, message }) => [path.join('.'), message])
}

describe('회원가입 이메일 단계', () => {
  it('앞뒤 공백을 지운다', () => {
    expect(signupEmailSchema.parse({ email: ' pm@example.com ' })).toEqual({
      email: 'pm@example.com',
    })
  })

  it.each([
    ['', AUTH_MESSAGES.emailRequired],
    ['pm', AUTH_MESSAGES.emailFormat],
    ['pm@', AUTH_MESSAGES.emailFormat],
  ])('이메일 %j 는 %s', (email, message) => {
    expect(issues(signupEmailSchema.safeParse({ email }))).toEqual([['email', message]])
  })
})

describe('회원가입 코드 단계', () => {
  it('메일에서 복사한 앞뒤 공백을 지운다', () => {
    expect(signupCodeSchema.parse({ code: ' 012345 ' })).toEqual({ code: '012345' })
  })

  it.each(['', '12345', '1234567', '12a456', '１２３４５６'])('코드 %j 는 거절한다', (code) => {
    expect(issues(signupCodeSchema.safeParse({ code }))).toEqual([
      ['code', AUTH_MESSAGES.codeFormat],
    ])
  })
})

describe('회원가입 프로필 단계', () => {
  const valid = { name: '최진호', password: 'abcd1234' }

  it('이름의 앞뒤 공백을 지운다', () => {
    expect(signupProfileSchema.parse({ ...valid, name: '  최진호 ' })).toEqual(valid)
  })

  it('이름은 필수다 — 공백만 있어도 비었다', () => {
    expect(issues(signupProfileSchema.safeParse({ ...valid, name: '   ' }))).toEqual([
      ['name', AUTH_MESSAGES.nameRequired],
    ])
  })

  it.each([
    ['abc123', '8자 미만'],
    ['abcdefgh', '숫자 없음'],
  ])('비밀번호 %j 는 거절한다 (%s)', (password) => {
    expect(issues(signupProfileSchema.safeParse({ ...valid, password }))[0]).toEqual([
      'password',
      AUTH_MESSAGES.passwordRule,
    ])
  })

  it('비밀번호는 8자 이상이고 숫자가 있으면 된다 — 강도는 보지 않는다', () => {
    expect(signupProfileSchema.safeParse({ ...valid, password: '1aaaaaaa' }).success).toBe(true)
    expect(signupProfileSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true)
  })

  it('약관 동의 칸이 없다', () => {
    expect(Object.keys(signupProfileSchema.shape)).toEqual(['name', 'password'])
  })
})

describe('로그인 검증', () => {
  it('이메일 형식과 비밀번호 빈 값만 본다 — 비밀번호 규칙은 가입 때만이다', () => {
    expect(loginSchema.safeParse({ email: 'pm@example.com', password: 'x' }).success).toBe(true)
    expect(issues(loginSchema.safeParse({ email: 'pm', password: '' }))).toEqual([
      ['email', AUTH_MESSAGES.emailFormat],
      ['password', AUTH_MESSAGES.passwordRequired],
    ])
  })
})

describe('비밀번호 재설정 검증 (#356)', () => {
  it('요청은 이메일 하나다. 앞뒤 공백을 지우고 형식을 본다', () => {
    expect(forgotPasswordSchema.parse({ email: ' pm@example.com ' })).toEqual({
      email: 'pm@example.com',
    })
    expect(issues(forgotPasswordSchema.safeParse({ email: '' }))).toEqual([
      ['email', AUTH_MESSAGES.emailRequired],
    ])
    expect(issues(forgotPasswordSchema.safeParse({ email: 'pm' }))).toEqual([
      ['email', AUTH_MESSAGES.emailFormat],
    ])
  })

  it.each([
    ['', AUTH_MESSAGES.passwordRequired],
    ['abc123', AUTH_MESSAGES.passwordRule],
    ['abcdefgh', AUTH_MESSAGES.passwordRule],
  ])('새 비밀번호 %j 는 가입과 같은 규칙으로 거절한다', (newPassword, message) => {
    expect(issues(resetPasswordSchema.safeParse({ newPassword }))[0]).toEqual([
      'newPassword',
      message,
    ])
  })

  it('새 비밀번호는 8자 이상이고 숫자가 있으면 된다. 공백도 값이다', () => {
    expect(resetPasswordSchema.parse({ newPassword: ' pass1234 ' })).toEqual({
      newPassword: ' pass1234 ',
    })
  })
})
