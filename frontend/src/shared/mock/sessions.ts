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
