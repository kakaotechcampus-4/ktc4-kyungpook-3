import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { initialDb, replaceDb } from './db'
import type { MockDb } from './db'
import { MOCK_NOW } from './fixtures/constants'

/*
 * 브라우저·E2E 용 시작 상태. 모두 픽스처 계정 pm@example.com / mock-password 로 로그인한다.
 * 시나리오마다 initialDb() 에서 새로 만든다 — 앞 시나리오의 변경이 다음 시나리오에 남지 않는다.
 * Vitest 는 이 파일을 거치지 않는다. setup.ts 의 resetDb() 가 initialDb() 를 그대로 쓴다.
 */

export const MOCK_SCENARIOS = [
  'signed-out',
  'no-workspace',
  'single-workspace',
  'multiple-workspaces',
  'incomplete-workspace',
] as const
export type MockScenario = (typeof MOCK_SCENARIOS)[number]

/** 브라우저 MSW 는 비로그인으로 시작한다. 로그인은 픽스처 계정이나 새 가입으로 한다 */
export const BROWSER_DEFAULT_SCENARIO: MockScenario = 'signed-out'

export function isMockScenario(value: string | null): value is MockScenario {
  return (MOCK_SCENARIOS as readonly (string | null)[]).includes(value)
}

/** 생성 단계만 마친 PM 공간. 다음은 Discord 연결이다 */
const incompleteWorkspace: WorkspaceDto = {
  workspace_id: 'ws_03',
  name: '설정 중인 팀',
  role: 'pm',
  created_at: '2026-09-03T00:00:00Z',
  onboarding: {
    completed: false,
    current_step: 'connect_discord',
    steps: [
      { step: 'create_workspace', status: 'completed' },
      { step: 'connect_discord', status: 'pending' },
      { step: 'connect_notion', status: 'pending' },
      { step: 'connect_members', status: 'pending' },
    ],
  },
}

/** 픽스처 계정을 로그인시키고 소속을 workspaceIds 로 맞춘다. 마지막 공간은 마지막 소속이다 */
function signInWith(state: MockDb, workspaceIds: string[], lastWorkspaceId: string | null): void {
  const account = state.accounts[0]
  account.workspaceIds = workspaceIds
  account.session.workspace_count = workspaceIds.length
  account.session.last_workspace_id = lastWorkspaceId
  state.session = structuredClone(account.session)
  state.authenticated = true
}

export function createScenarioDb(scenario: MockScenario): MockDb {
  const state = initialDb()
  switch (scenario) {
    case 'signed-out':
      state.authenticated = false
      break
    case 'no-workspace':
      signInWith(state, [], null)
      break
    case 'single-workspace':
      signInWith(state, ['ws_01'], 'ws_01')
      break
    case 'multiple-workspaces':
      // initialDb() 가 이미 ws_01·ws_02 소속으로 로그인한 상태다
      break
    case 'incomplete-workspace':
      state.workspaces.push(structuredClone(incompleteWorkspace))
      // 백엔드처럼 생성자가 PM 팀원으로 있다
      state.members.push({
        member_id: 'mb_90',
        workspace_id: 'ws_03',
        display_name: state.accounts[0].session.user.name,
        discord_user_id: null,
        notion_name: null,
        role: 'pm',
        created_at: MOCK_NOW,
      })
      state.integrations.ws_03 = {
        discord: { status: 'not_connected', display_name: null, connected_at: null },
        notion: { status: 'not_connected', display_name: null, connected_at: null },
      }
      signInWith(state, ['ws_03'], 'ws_03')
      break
  }
  return state
}

export function applyScenario(scenario: MockScenario): void {
  replaceDb(createScenarioDb(scenario))
}
