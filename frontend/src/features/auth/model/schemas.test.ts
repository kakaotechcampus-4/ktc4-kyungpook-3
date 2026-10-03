import { AUTH_MESSAGES, loginSchema, signupSchema } from './schemas'

function issues(result: {
  success: boolean
  error?: { issues: { path: PropertyKey[]; message: string }[] }
}) {
  return (result.error?.issues ?? []).map(({ path, message }) => [path.join('.'), message])
}

describe('회원가입 검증', () => {
  const valid = { name: '최진호', email: 'pm@example.com', password: 'abcd1234' }

  it('이름·이메일·비밀번호가 규칙에 맞으면 통과하고 이름·이메일의 앞뒤 공백을 지운다', () => {
    expect(
      signupSchema.parse({ name: '  최진호 ', email: ' pm@example.com ', password: 'abcd1234' }),
    ).toEqual(valid)
  })

  it('이름은 필수다 — 공백만 있어도 비었다', () => {
    expect(issues(signupSchema.safeParse({ ...valid, name: '   ' }))).toEqual([
      ['name', AUTH_MESSAGES.nameRequired],
    ])
  })

  it.each([
    ['', AUTH_MESSAGES.emailRequired],
    ['pm', AUTH_MESSAGES.emailFormat],
    ['pm@', AUTH_MESSAGES.emailFormat],
  ])('이메일 %j 는 %s', (email, message) => {
    expect(issues(signupSchema.safeParse({ ...valid, email }))).toEqual([['email', message]])
  })

  it.each([
    ['abc123', '8자 미만'],
    ['abcdefgh', '숫자 없음'],
  ])('비밀번호 %j 는 거절한다 (%s)', (password) => {
    expect(issues(signupSchema.safeParse({ ...valid, password }))[0]).toEqual([
      'password',
      AUTH_MESSAGES.passwordRule,
    ])
  })

  it('비밀번호는 8자 이상이고 숫자가 있으면 된다 — 강도는 보지 않는다', () => {
    expect(signupSchema.safeParse({ ...valid, password: '1aaaaaaa' }).success).toBe(true)
    expect(signupSchema.safeParse({ ...valid, password: '12345678' }).success).toBe(true)
  })

  it('약관 동의 칸이 없다', () => {
    expect(Object.keys(signupSchema.shape)).toEqual(['name', 'email', 'password'])
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
