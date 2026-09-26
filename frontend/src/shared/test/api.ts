import type { Envelope } from '@/shared/types/api/envelope'
import { unwrap } from '@/shared/api/envelope'

/** 테스트 전용 fetch→unwrap. 프로덕션 HTTP 클라이언트는 M3에서 만든다. */
export async function fetchDto<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${location.origin}/api/v1${path}`, init)
  return unwrap((await response.json()) as Envelope<T>, response.status)
}
export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
