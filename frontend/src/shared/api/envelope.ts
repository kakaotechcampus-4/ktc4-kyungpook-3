import type { Envelope } from '@/shared/types/api/envelope'
import { ApiError } from './errors'

export function unwrap<T>(response: Envelope<T>, status: number): T {
  if (response.error !== null) throw new ApiError(response.error, status)
  return response.data
}
