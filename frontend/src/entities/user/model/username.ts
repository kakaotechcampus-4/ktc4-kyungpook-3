/*
 * 아이디 규칙 (#627, BE schemas/username.py). 가입·아이디 변경·중복 확인이 함께 쓴다.
 * 앞뒤 공백을 지우고 영문·숫자 4~20자인지 본 뒤 소문자로 바꾼다. 대소문자를 가리지 않고 유일하다.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9]{4,20}$/

/** 입력 아래에 늘 보이는 규칙 안내 */
export const USERNAME_HINT = '영문·숫자 4~20자'

export const USERNAME_MESSAGES = {
  available: '사용할 수 있는 아이디예요.',
  checking: '아이디를 확인하고 있어요.',
  taken: '이미 사용 중인 아이디예요.',
  invalid: '아이디는 영문과 숫자로 된 4~20자로 입력해 주세요.',
  current: '지금 쓰고 있는 아이디예요.',
} as const

/** 서버가 저장·비교하는 모양. 규칙에 맞는지는 보지 않는다 */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase()
}

/** 소문자로 바꾸기 전에 본다. BE 처럼 `lower()` 를 거쳐야 ASCII 가 되는 글자(켈빈 기호 등)를 받지 않는다 */
export function isUsernameAllowed(input: string): boolean {
  return USERNAME_PATTERN.test(input.trim())
}

/**
 * 아이디 확인 상태. `username` 은 정규화한 값이다.
 * 가입·저장할 수 있는가는 이벤트로 지우지 않고 파생한다: `available` 이고 그 `username` 이 지금 입력과 같을 때다.
 * `current` 는 설정에서 지금 내 아이디와 같은 값이다(서버는 내 아이디도 `taken` 이라 먼저 비교한다).
 */
export type UsernameCheck =
  | { status: 'idle' }
  | { status: 'checking'; username: string }
  | { status: 'available'; username: string }
  | { status: 'unavailable'; username: string; reason: UsernameUnavailableReason }
  | { status: 'failed'; username: string; error: unknown }

export type UsernameUnavailableReason = 'taken' | 'invalid' | 'current'
