import type { z } from 'zod'
import { ApiError, CLIENT_ERROR_CODES } from './errors'

/** zod 경로를 `items[3].status` 처럼 쓴다. 응답 전체가 틀렸으면 빈 문자열이다 */
export function formatResponsePath(path: readonly PropertyKey[]): string {
  return path
    .map((key, index) =>
      typeof key === 'number' ? `[${key}]` : `${index === 0 ? '' : '.'}${String(key)}`,
    )
    .join('')
}

/**
 * 성공 응답을 쓸 수 없다. 화면은 `INVALID_RESPONSE` 문구를 보이고 Query 는 다시 요청하지 않는다.
 * `details` 에는 어느 entity 의 어느 필드인지만 둔다. 받은 값은 넣지 않는다 (D-140, #358 수집 대상)
 */
export function createInvalidResponseError(entity: string, path: string): ApiError {
  return new ApiError(
    {
      code: CLIENT_ERROR_CODES.INVALID_RESPONSE,
      message: `invalid ${entity} response at ${path || '(root)'}`,
      details: { entity, path },
    },
    0,
    'invalid_response',
  )
}

function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let value = data
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<PropertyKey, unknown>)[key]
  }
  return value
}

/**
 * entity 의 요청 함수가 `request<unknown>` 으로 받은 성공 데이터를 스키마로 읽는다. 틀리면 첫 문제 필드로
 * `INVALID_RESPONSE` 를 던진다. 개발 모드에서는 모든 문제 필드의 경로와 받은 값을 경고로 남긴다
 */
export function parseResponse<S extends z.ZodType>(
  schema: S,
  data: unknown,
  entity: string,
): z.output<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const issues = result.error.issues
  if (import.meta.env.DEV)
    console.warn(
      `Invalid ${entity} response`,
      issues.map((issue) => ({
        path: formatResponsePath(issue.path),
        problem: issue.message,
        value: valueAt(data, issue.path),
      })),
    )
  throw createInvalidResponseError(entity, formatResponsePath(issues[0]?.path ?? []))
}
