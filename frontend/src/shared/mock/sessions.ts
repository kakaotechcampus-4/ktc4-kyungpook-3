import { db } from './db'
import type { MockDb } from './db'

/*
 * 로그인한 사람의 공간별 역할. MSW 는 계정이 하나라 역할이 워크스페이스 행의 `role` 이다 —
 * 실 API 도 목록·상세의 `role` 을 현재 사용자 기준으로 준다 (계약 §4.2). 회의록 `permissions` 도 이 값으로 정해진다.
 * 통합 테스트는 `setMockRole('member')` 로, E2E 는 `meeting-member` 시나리오로 일반 팀원 세션을 고른다.
 */

export type MockRole = 'pm' | 'member'

export const MOCK_ROLES = ['pm', 'member'] as const satisfies readonly MockRole[]

/** 픽스처 계정의 그 공간 역할을 바꾼다. 기본은 ws_01 — 온보딩을 마친 공간이다 */
export function setMockRole(role: MockRole, workspaceId = 'ws_01', state: MockDb = db): void {
  const workspace = state.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)
  if (!workspace) throw new Error(`mock workspace ${workspaceId} is missing`)
  workspace.role = role
}

/*
 * 로그인한 사람의 공간별 팀원 ID. 백엔드 require_member 는 (세션 user_id, workspace_id) 로 팀원 행을 찾아
 * 변경자(changed_by)·처리자(resolved_by)를 그 팀원으로 기록한다. MemberDto 에는 user_id 가 없어서
 * MSW 는 db 에서 이 대응을 찾을 수 없다 — 저장 모양을 바꾸지 않으려고 대응을 여기 고정해 둔다.
 * 픽스처 계정 us_01 은 ws_01 에서 mb_01(PM) 이다. 기존 테스트가 처리자·변경자로 넣던 값과 같다.
 * 표에 없는 공간에서는 세션 팀원을 정할 수 없으므로 태스크·승인 쓰기가 403 이다.
 */
const SESSION_MEMBERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  us_01: { ws_01: 'mb_01' },
}

/** 지금 세션의 그 공간 팀원 ID. 대응이 없거나 그 팀원이 그 공간에 없으면 null */
export function sessionMemberId(workspaceId: string, state: MockDb = db): string | null {
  const memberId = SESSION_MEMBERS[state.session.user.user_id]?.[workspaceId]
  if (memberId === undefined) return null
  return state.members.some(
    (member) => member.member_id === memberId && member.workspace_id === workspaceId,
  )
    ? memberId
    : null
}
