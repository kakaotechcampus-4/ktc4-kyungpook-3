import { z } from 'zod'

/* URL 값은 페이지 경계에서 한 번 검증한다 (D-132). 필터·정렬·페이지네이션 규격은 결정 전이라 만들지 않는다. */

/** 서버 ID 모양. 공백·슬래시·점 같은 문자가 섞이면 API 를 부르기 전에 버린다 */
const routeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** 경로 파라미터를 ID 로 읽는다. 없거나 모양이 틀리면 null */
export function parseRouteId(value: string | undefined): string | null {
  const parsed = routeIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** 정해진 값 중 하나일 때만 돌려준다 */
export function parseEnumParam<const T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | null {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : null
}
