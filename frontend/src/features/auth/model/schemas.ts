import { z } from 'zod'

/* 캔버스에 오류 문구가 한 줄도 없다(ErrorText 참고). 아래 문구는 D-142·D-149 에 맞춘 이 기능 전용 문구다 */
export const AUTH_MESSAGES = {
  nameRequired: '이름을 입력해 주세요.',
  emailRequired: '이메일을 입력해 주세요.',
  emailFormat: '이메일 형식으로 입력해 주세요.',
  passwordRequired: '비밀번호를 입력해 주세요.',
  passwordRule: '비밀번호는 8자 이상이고 숫자를 포함해야 해요.',
} as const

/** 비밀번호 규칙 안내. 회원가입 입력 아래에 늘 보인다 — Signup 캔버스의 `8자 이상, 숫자 포함` */
export const PASSWORD_HINT = '8자 이상, 숫자 포함'

export const PASSWORD_MIN_LENGTH = 8

/** 앞뒤 공백은 지우고 검사한다. 비어 있으면 형식 오류보다 `입력해 주세요` 가 먼저다 */
const email = z
  .string()
  .trim()
  .min(1, AUTH_MESSAGES.emailRequired)
  .pipe(z.email(AUTH_MESSAGES.emailFormat))

/** 로그인은 형식과 빈 값만 본다. 비밀번호 규칙은 가입 때만이다 (계획 ①) */
export const loginSchema = z.object({
  email,
  // 비밀번호는 공백도 값이다 — trim 하지 않는다
  password: z.string().min(1, AUTH_MESSAGES.passwordRequired),
})
export type LoginValues = z.infer<typeof loginSchema>

/** 이름 필수 · 이메일 형식 · 비밀번호 8자 이상 + 숫자. 강도 표시와 약관 동의는 이번 범위가 아니다 */
export const signupSchema = z.object({
  name: z.string().trim().min(1, AUTH_MESSAGES.nameRequired),
  email,
  password: z
    .string()
    .min(1, AUTH_MESSAGES.passwordRequired)
    .min(PASSWORD_MIN_LENGTH, AUTH_MESSAGES.passwordRule)
    .regex(/\d/, AUTH_MESSAGES.passwordRule),
})
export type SignupValues = z.infer<typeof signupSchema>
