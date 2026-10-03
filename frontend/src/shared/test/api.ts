import { request } from '@/shared/api/client'
import type { HttpMethod, RequestOptions } from '@/shared/api/client'
import { ApiError } from '@/shared/api/errors'
import type { SessionDto } from '@/shared/types/api/auth'

/**
 * 테스트 전용 진입점. 제품과 같은 `request()` 를 탄다 — 봉투 해제·오류 정규화·204 처리가 같다.
 * 예전 fetch 경로는 없앴다. 이름과 호출 모양은 기존 통합 테스트를 위해 그대로 둔다.
 */
export function fetchDto<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>(path, options)
}

export function jsonRequest(method: HttpMethod, body: unknown): RequestOptions {
  return { method, body }
}

/** `/auth/me` 의 DTO. 401 이면 비로그인이라 null 이다. entities 를 쓸 수 없는 shared 테스트용이다 */
export async function fetchSessionDto(): Promise<SessionDto | null> {
  try {
    return await request<SessionDto>('/auth/me')
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'http' && error.status === 401) return null
    throw error
  }
}
