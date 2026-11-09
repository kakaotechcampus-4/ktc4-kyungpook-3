import { fail } from './envelope'

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
