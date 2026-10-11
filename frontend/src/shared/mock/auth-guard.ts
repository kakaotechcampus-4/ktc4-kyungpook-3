import { db } from './db'
import { fail } from './envelope'
import { sessionMemberId } from './sessions'

type Denied = ReturnType<typeof fail>

/** 백엔드 `deps.get_current_user` 에 대응한다.
 *
 * 실 API 는 `session_token` 쿠키로 세션 행을 찾고 만료를 확인한다. MSW 는 쿠키를 굽지 않고
 * `db.authenticated` 로 **결과만** 흉내낸다. `login` · `signup` 이 `true`, `logout` 이 `false` 로 바꾼다.
 *
 * 통과하면 `null`, 막히면 401 응답을 돌려준다. handler 는 `if (denied) return denied` 로 쓴다.
 */
export function requireAuth(): Denied | null {
  return db.authenticated ? null : fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)
}

/** 백엔드 `deps.get_current_member` 에 대응한다. 인증 + 해당 워크스페이스 소속까지 본다.
 *
 * `GET /workspaces/{id}/meetings` 와 `GET /meetings/{id}/minutes` 처럼 의존성 대신
 * 본문에서 직접 멤버를 조회하는 곳도 결과가 같으므로 이 함수를 쓴다.
 */
export function requireMember(workspaceId: string): Denied | null {
  const unauthenticated = requireAuth()
  if (unauthenticated) return unauthenticated
  const account = db.accounts.find(
    ({ session }) => session.user.user_id === db.session.user.user_id,
  )
  return account?.workspaceIds.includes(workspaceId)
    ? null
    : fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403)
}

/** 백엔드 `deps.require_pm` 에 대응한다. 인증 + 소속 + 그 공간의 PM 이어야 한다.
 *
 * 역할은 워크스페이스 행의 `role` 로 본다(sessions.ts — `setMockRole` 이 바꾸는 값). 통과하면 기록에 쓸
 * 세션 팀원 ID 를 돌려준다. 본문·쿼리의 `changed_by`·`resolved_by` 는 쓰지 않는다. 세션 팀원을 정할 수
 * 없는 공간도 403 이다. handler 는 상태를 바꾸기 전에 `if (pm instanceof Response) return pm` 으로 쓴다.
 */
export function requirePm(workspaceId: string): Denied | { memberId: string } {
  const denied = requireMember(workspaceId)
  if (denied) return denied
  const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)
  const memberId = sessionMemberId(workspaceId)
  if (workspace?.role !== 'pm' || memberId === null)
    return fail('FORBIDDEN', 'PM만 할 수 있는 작업입니다.', 403, { workspace_id: workspaceId })
  return { memberId }
}
