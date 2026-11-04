import { db } from './db'
import type { MockDb, MockInvitation } from './db'

/*
 * 로그인한 사람의 공간별 역할. 픽스처·생성자 계정은 역할이 워크스페이스 행의 `role` 이다 —
 * 실 API 도 목록·상세의 `role` 을 현재 사용자 기준으로 준다 (계약 §4.2). 회의록 `permissions` 도 이 값으로 정해진다.
 * 통합 테스트는 `setMockRole('member')` 로, E2E 는 `meeting-member` 시나리오로 일반 팀원 세션을 고른다.
 * 초대를 수락해 팀원과 이어진 계정은 그 팀원 행의 역할을 따른다 — 행의 `role` 을 다른 계정과 함께 쓰지 않는다.
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
 * MSW 는 픽스처 계정의 대응을 db 에서 찾을 수 없다 — 저장 모양을 바꾸지 않으려고 대응을 여기 고정해 둔다.
 * 픽스처 계정 us_01 은 ws_01 에서 mb_01(PM) 이다. 기존 테스트가 처리자·변경자로 넣던 값과 같다.
 * 초대로 이어진 계정은 수락한 초대가 대응이다. 둘 다 없는 공간에서는 세션 팀원을 정할 수 없으므로 태스크·승인 쓰기가 403 이다.
 */
const SESSION_MEMBERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  us_01: { ws_01: 'mb_01' },
}

/** 초대 이메일 비교 형태. 백엔드 normalize_email 과 같다. 가입·로그인 이메일은 백엔드도 입력 그대로 비교한다 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

const currentUserId = (state: MockDb) => state.session.user.user_id

/** 이 계정을 그 공간 팀원과 잇는 수락한 초대. 그 팀원이 지워졌으면 없다 */
function linkOf(workspaceId: string, userId: string, state: MockDb): MockInvitation | undefined {
  return state.invitations.find(
    (invitation) =>
      invitation.workspace_id === workspaceId &&
      invitation.status === 'accepted' &&
      invitation.accepted_user_id === userId &&
      state.members.some(({ member_id }) => member_id === invitation.member_id),
  )
}

function isListedIn(workspaceId: string, userId: string, state: MockDb): boolean {
  return (
    state.accounts
      .find(({ session }) => session.user.user_id === userId)
      ?.workspaceIds.includes(workspaceId) ?? false
  )
}

/** 그 공간 소속인가. 계정의 workspaceIds(픽스처·생성자) 또는 수락한 초대다 */
export function isMemberOf(
  workspaceId: string,
  userId = currentUserId(db),
  state: MockDb = db,
): boolean {
  return isListedIn(workspaceId, userId, state) || linkOf(workspaceId, userId, state) !== undefined
}

/** 그 공간에서의 역할. 초대로 이어졌으면 그 팀원 행의 역할, 아니면 워크스페이스 행의 역할. 소속이 아니면 null */
export function roleIn(
  workspaceId: string,
  userId = currentUserId(db),
  state: MockDb = db,
): MockRole | null {
  const link = linkOf(workspaceId, userId, state)
  if (link) {
    const member = state.members.find(({ member_id }) => member_id === link.member_id)
    return member?.role === 'pm' ? 'pm' : 'member'
  }
  if (!isListedIn(workspaceId, userId, state)) return null
  const workspace = state.workspaces.find(({ workspace_id }) => workspace_id === workspaceId)
  return workspace?.role === 'pm' ? 'pm' : 'member'
}

/** 지금 세션의 그 공간 팀원 ID. 대응이 없거나 그 팀원이 그 공간에 없으면 null */
export function sessionMemberId(workspaceId: string, state: MockDb = db): string | null {
  const memberId =
    linkOf(workspaceId, currentUserId(state), state)?.member_id ??
    SESSION_MEMBERS[currentUserId(state)]?.[workspaceId]
  if (memberId === undefined) return null
  return state.members.some(
    (member) => member.member_id === memberId && member.workspace_id === workspaceId,
  )
    ? memberId
    : null
}

/** 그 팀원과 이어진 계정. 수락한 초대, 아니면 픽스처 대응. 없으면 null */
export function linkedUserIdOf(memberId: string, state: MockDb = db): string | null {
  const accepted = state.invitations.find(
    (invitation) => invitation.member_id === memberId && invitation.status === 'accepted',
  )
  if (accepted) return accepted.accepted_user_id
  const member = state.members.find(({ member_id }) => member_id === memberId)
  if (!member) return null
  const fixture = Object.entries(SESSION_MEMBERS).find(
    ([, members]) => members[member.workspace_id] === memberId,
  )
  return fixture?.[0] ?? null
}
