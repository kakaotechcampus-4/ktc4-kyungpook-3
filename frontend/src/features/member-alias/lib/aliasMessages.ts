import type { AliasSource } from '@/entities/member'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES, isCanceledError } from '@/shared/api/errors'

/* 별칭 관리의 문구. 해요체로 원인과 PM 이 할 일을 함께 쓴다 (D-149). 근거는 backend members.py 와 #523 */

/** 별칭이 어디서 왔는지. 칩마다 작게 붙인다 */
export const ALIAS_SOURCE_LABEL: Record<AliasSource, string> = {
  learned: '회의에서 배움',
  display_name: '이름',
  discord_profile: '디스코드',
  manual: '직접 추가',
}

export const ALIAS_UNVERIFIED = '미확인'
export const ALIAS_EXISTS = '이미 있는 별칭이에요.'
export const ALIAS_EMPTY = '등록된 별칭이 없어요.'
export const ALIAS_LOAD_FAILED = '별칭을 불러오지 못했어요.'

/** 서버는 받은 글자 수로 1~100자를 본다 (schemas/member.py) */
export const ALIAS_MAX_LENGTH = 100
const ALIAS_LENGTH = '별칭은 1~100자로 적어 주세요.'

export const aliasRemoved = (text: string) => `'${text}' 별칭을 지웠어요`

/** 서버가 저장하는 모양으로 다듬는다 — 앞뒤 공백을 지우고 안쪽 공백을 한 칸으로 (matching.py normalize_alias_text) */
export function normalizeAliasText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 보내기 전에 막을 입력의 문구. 비었으면 추가 단추가 잠겨 있어 문구가 없다. 서버(Python)처럼 문자(코드 포인트)로 센다 */
export function aliasInputFailure(aliasText: string): string | null {
  return [...aliasText].length > ALIAS_MAX_LENGTH ? ALIAS_LENGTH : null
}

const KNOWN: Readonly<Record<string, string>> = {
  [ERROR_CODES.INVALID_REQUEST]: ALIAS_LENGTH,
  [ERROR_CODES.FORBIDDEN]: 'PM만 별칭을 바꿀 수 있어요.',
  [ERROR_CODES.MEMBER_NOT_FOUND]: '팀원을 찾을 수 없어요. 팀원 목록을 새로 불러왔어요.',
  [ERROR_CODES.MEMBER_ALIAS_NOT_FOUND]: '이미 지워진 별칭이에요.',
}

/** 추가·삭제 실패 문구. 취소는 실패가 아니라 null 이다 */
export function aliasFailure(error: unknown): string | null {
  if (isCanceledError(error)) return null
  return error instanceof ApiError && Object.hasOwn(KNOWN, error.code)
    ? KNOWN[error.code]
    : errorMessage(error)
}
