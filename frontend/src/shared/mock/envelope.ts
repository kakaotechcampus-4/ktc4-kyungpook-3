import { HttpResponse } from 'msw'
import type { HttpResponseInit } from 'msw'
import type { ApiErrorDto, Envelope, ListDto } from '@/shared/types/api/envelope'

export function ok<T>(data: T, init?: HttpResponseInit): HttpResponse<Envelope<T>> {
  return HttpResponse.json({ data, error: null } satisfies Envelope<T>, init)
}
export function list<T>(items: T[], init?: HttpResponseInit): HttpResponse<Envelope<ListDto<T>>> {
  return ok({ items, total: items.length }, init)
}
export function fail(
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown> | null = null,
): HttpResponse<Envelope<never>> {
  const error: ApiErrorDto = { code, message, details }
  return HttpResponse.json({ data: null, error } satisfies Envelope<never>, { status })
}
