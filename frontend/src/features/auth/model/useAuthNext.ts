import { useSearchParams } from 'react-router'
import { LOGIN_PARAMS } from '@/shared/config/routes'
import { parseReturnPath } from '@/shared/lib/return-path'

/** 인증 화면 주소의 `next`. 앱 안 보호 경로가 아니면 없는 것으로 본다 */
export function useAuthNext(): string | undefined {
  const [searchParams] = useSearchParams()
  return parseReturnPath(searchParams.get(LOGIN_PARAMS.next)) ?? undefined
}
