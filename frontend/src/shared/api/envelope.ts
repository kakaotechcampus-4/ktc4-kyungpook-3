import type { ApiErrorDto, Envelope } from '@/shared/types/api/envelope'
import { ApiError } from './errors'

export function unwrap<T>(response: Envelope<T>, status: number): T {
  if (response.error !== null) throw new ApiError(response.error, status)
  return response.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorDto(value: unknown): ApiErrorDto | null {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') {
    return null
  }
  return {
    code: value.code,
    message: value.message,
    details: isRecord(value.details) ? value.details : null,
  }
}

/**
 * 응답 본문 문자열을 봉투로 읽는다. JSON 이 아니거나 `{data, error}` 모양이 아니면 null 이다.
 * 던지지 않는다 — 무엇이 잘못됐는지는 상태 코드와 함께 호출자가 정한다.
 */
export function parseEnvelope(body: unknown): Envelope<unknown> | null {
  if (typeof body !== 'string' || body === '') return null
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value) || !('data' in value) || !('error' in value)) return null
  if (value.error === null) return { data: value.data, error: null }
  const error = toErrorDto(value.error)
  return error === null ? null : { data: null, error }
}
