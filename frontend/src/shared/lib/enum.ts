/** 모르는 서버 유니온은 안전한 기본값으로 내리고 개발 모드에만 경고한다. */
export function enumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
  field: string,
): T {
  if (allowed.includes(value as T)) return value as T
  if (import.meta.env.DEV) console.warn(`Unknown ${field}: ${value}`)
  return fallback
}
