import { paths } from '@/shared/config/routes'
import { safeReturnPath } from '@/shared/lib/oauth'

/**
 * Notion 연결이 끝난 뒤 돌아갈 곳. **그 공간의 업로드 경로 하나만** 받는다 (U3-2, D-098).
 * 외부 주소, 다른 공간, 같은 공간의 다른 화면, 검색·해시가 붙은 주소는 모두 null — 설정에 머문다.
 * 열린 리다이렉트를 막는 `safeReturnPath` 를 먼저 거치고, 남은 경로를 정확히 비교한다.
 */
export function uploadReturnTarget(workspaceId: string, raw: string | null): string | null {
  const path = safeReturnPath(raw)
  const upload = paths.meetingUpload(workspaceId)
  return path === upload ? upload : null
}
