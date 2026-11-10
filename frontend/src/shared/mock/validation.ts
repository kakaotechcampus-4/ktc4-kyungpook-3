import { PYTHON_STRIP } from '@/shared/lib/validation'
import { fail } from './envelope'

export { PYTHON_STRIP }

/**
 * BE `_has_unstorable`. DB 에 쓸 수 없는 NUL 과 짝 없는 서로게이트가 있으면 true 다.
 * `u` 플래그는 짝이 맞은 쌍을 한 글자로 읽어 `\p{Cs}` 가 짝 없는 반쪽만 잡는다
 */
export function hasUnstorable(...texts: (string | null)[]): boolean {
  return texts.some((text) => text !== null && (text.includes('\u0000') || /\p{Cs}/u.test(text)))
}

/** BE validate_username. 앞뒤 공백을 지우고 영문·숫자 4~20자면 소문자로, 아니면 null 이다 */
export function checkedUsername(value: string): string | null {
  const username = value.replace(PYTHON_STRIP, '')
  return /^[A-Za-z0-9]{4,20}$/.test(username) ? username.toLowerCase() : null
}

/** BE 본문 검증(pydantic) 오류 한 칸. 400 `INVALID_REQUEST` 의 `details.fields` 에 들어간다 */
export interface FieldError {
  loc: string[]
  msg: string
}

/** 필수 문자열 칸을 BE 처럼 검사한다. 없거나 문자열이 아니면 그 칸의 오류다 */
export function stringField(body: Record<string, unknown>, name: string): FieldError | null {
  const value = body[name]
  if (value === undefined) return { loc: ['body', name], msg: 'Field required' }
  if (typeof value !== 'string')
    return { loc: ['body', name], msg: 'Input should be a valid string' }
  return null
}

/** BE validate_password. 길이는 `len()` 처럼 코드 포인트로 세고, 숫자는 ASCII 0-9 만 본다 */
export function passwordField(body: Record<string, unknown>, name: string): FieldError | null {
  const typeError = stringField(body, name)
  if (typeError) return typeError
  const value = body[name] as string
  if ([...value].length >= 8 && /[0-9]/.test(value)) return null
  return {
    loc: ['body', name],
    msg: 'Value error, 비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다.',
  }
}

/** pydantic 은 칸마다 오류를 모아 한 번에 답한다. 오류가 하나도 없으면 null 이다 */
export function invalidBody(...fields: (FieldError | null)[]) {
  const errors = fields.filter((error): error is FieldError => error !== null)
  return errors.length > 0
    ? fail('INVALID_REQUEST', '요청이 올바르지 않습니다.', 400, { fields: errors })
    : null
}

/** 필수 아이디 칸을 BE 처럼 검사한다 */
export function usernameField(body: Record<string, unknown>, name: string): FieldError | null {
  const typeError = stringField(body, name)
  if (typeError) return typeError
  return checkedUsername(body[name] as string) === null
    ? { loc: ['body', name], msg: 'Value error, 아이디는 영문과 숫자로 된 4~20자여야 합니다.' }
    : null
}
