import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { userSchema, usernameAvailabilitySchema } from '@/shared/types/api/auth'
import type { UsernameUpdateDto } from '@/shared/types/api/auth'
import { toUser } from '../model/mapper'
import type { User } from '../model/types'

/** 로그인 없이 부른다. 규칙 밖 값도 오류가 아니라 `invalid` 다. 내 아이디도 `taken` 이다 */
export async function fetchUsernameAvailability(
  username: string,
  signal?: AbortSignal,
): Promise<{ available: true } | { available: false; reason: 'taken' | 'invalid' }> {
  const data = parseResponse(
    usernameAvailabilitySchema,
    await request<unknown>('/auth/username-availability', { params: { username }, signal }),
    'user',
  )
  return data.available ? { available: true } : { available: false, reason: data.reason }
}

/** 아이디를 바꾼다. 지금 아이디와 같으면 그대로 200, 남이 쓰면 409 `USERNAME_TAKEN`, 규칙 밖이면 400 `INVALID_REQUEST` */
export async function updateUsername(username: string, signal?: AbortSignal): Promise<User> {
  const body: UsernameUpdateDto = { username }
  return toUser(
    parseResponse(
      userSchema,
      await request<unknown>('/users/me', { method: 'PATCH', body, signal }),
      'user',
    ),
  )
}
