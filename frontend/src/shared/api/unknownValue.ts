/*
 * 응답의 모르는 값 규칙 (#348). 상태 판단·쓰기 기준 필드는 스키마가 목록 밖의 값을 거절한다(`INVALID_RESPONSE`).
 * 여기 둘은 그 밖의 필드용이다. 둘 다 개발 모드에서 경고한다
 */

/** 표시용 분류에 온 모르는 값. 다른 아는 값으로 바꾸지 않고 받은 문자열을 그대로 둔다 */
export interface UnknownValue {
  readonly unknown: string
}

function warnUnknown(field: string, value: string): void {
  if (import.meta.env.DEV) console.warn(`Unknown ${field}: ${value}`)
}

/** 표시용 분류. 모르는 값은 `UnknownValue` 로 남고 화면은 `알 수 없는 ○○` 로 읽는다 */
export function displayValue<T extends string>(
  value: string,
  known: readonly T[],
  field: string,
): T | UnknownValue {
  if ((known as readonly string[]).includes(value)) return value as T
  warnUnknown(field, value)
  return { unknown: value }
}

export function isKnownValue<T extends string>(value: T | UnknownValue): value is T {
  return typeof value === 'string'
}

/**
 * 보수 폴백. 권한·행동이 줄고 화면이 사실과 다르게 말하지 않는 값(`role` → `member`, 반영 상태 → 없음)으로만 내린다
 */
export function fallbackValue<T extends string, F>(
  value: string,
  known: readonly T[],
  fallback: F,
  field: string,
): T | F {
  if ((known as readonly string[]).includes(value)) return value as T
  warnUnknown(field, value)
  return fallback
}
