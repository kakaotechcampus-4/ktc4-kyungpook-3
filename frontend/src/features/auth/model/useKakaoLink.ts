import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { fetchKakaoPending } from '@/entities/user'
import type { KakaoPending } from '@/entities/user'

/**
 * 가입 화면 `kakao=1` 의 상태.
 * - `checking`: 대기 중인 카카오 신원을 읽는 중
 * - `ready`: 이 신원으로 가입을 이어 간다
 * - `expired`: 대기가 없거나 만료됐다. 카카오로 다시 시작해야 한다
 * - `failed`: 읽기 요청이 실패했다(네트워크·서버). 다시 시도할 수 있다
 */
export type KakaoLink =
  | { status: 'checking' }
  | { status: 'ready'; pending: KakaoPending }
  | { status: 'expired'; error: unknown }
  | { status: 'failed'; error: unknown; retry: () => void }

export const KAKAO_PENDING_QUERY_KEY = ['kakao-pending'] as const

export function isKakaoLinkExpired(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.KAKAO_LINK_EXPIRED
}

export interface KakaoLinkControl {
  link: KakaoLink
  /** 가입 요청이 대기 만료로 거절됐을 때 부른다 */
  expire: (error: unknown) => void
}

/**
 * 대기 쿠키는 HttpOnly 라 서버에 묻는다. 읽은 값은 상태로 두고 다시 묻지 않는다.
 * 가입이 끝나면 `useEnterSession` 이 캐시를 비우는데, 그때 다시 물으면 쿠키가 이미 지워져 만료 화면이 잠깐 보인다.
 */
export function useKakaoLink(): KakaoLinkControl {
  const [pending, setPending] = useState<KakaoPending | null>(null)
  const [expiredBy, setExpiredBy] = useState<unknown>(null)
  const query = useQuery({
    queryKey: KAKAO_PENDING_QUERY_KEY,
    queryFn: pending === null ? fetchKakaoPending : skipToken,
    staleTime: Infinity,
    gcTime: 0,
  })
  if (query.data !== undefined && pending === null) setPending(query.data)

  let link: KakaoLink
  if (expiredBy !== null) link = { status: 'expired', error: expiredBy }
  else if (pending !== null) link = { status: 'ready', pending }
  else if (query.isError && !query.isFetching) {
    link = isKakaoLinkExpired(query.error)
      ? { status: 'expired', error: query.error }
      : { status: 'failed', error: query.error, retry: () => void query.refetch() }
  } else link = { status: 'checking' }

  return { link, expire: setExpiredBy }
}
