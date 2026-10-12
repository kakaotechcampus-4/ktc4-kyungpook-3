import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { initialDb, replaceDb } from './db'
import type { MeetingFlowMode, MockDb } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { completeMeeting, setMeetingFlowMode } from './meetingFlow'
import { setMockRole } from './sessions'
import { createTask } from './task-state'

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
  // M5 회의 흐름. 모두 ws_01 하나에 로그인한다 — docs/impl-decision/2026-10-02-meeting-upload-policy.md
  'meeting-demo',
  'meeting-instant',
  'meeting-fail',
  'meeting-fail-notion-revoked',
  'meeting-notion-not-connected',
  'meeting-notion-revoked',
  'meeting-member',
  // M6 태스크·승인. 모두 ws_01 하나에 PM 으로 로그인한다(마지막만 일반 팀원). 전이는 handler 가 만든다
  'tasks-default',
  'tasks-empty',
  'approval-needs-input',
  'approval-rejected',
  'approval-resolved',
  'approval-conflict',
  'notion-sync-pending',
  'notion-sync-failed',
  'tasks-member',
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

/**
 * 회의를 올릴 수 있는 PM 의 ws_01. 픽스처의 처리 중 회의(mt_10)를 먼저 완료해 둔다 —
 * 처리 중 회의가 있으면 업로드가 409 이고(D-088) 진입이 처리 화면으로 바뀐다(D-090).
 */
function readyToUpload(state: MockDb, mode: MeetingFlowMode): void {
  signInWith(state, ['ws_01'], 'ws_01')
  completeMeeting('mt_10', state)
  setMeetingFlowMode(mode, state)
}

function setNotionStatus(state: MockDb, status: 'not_connected' | 'revoked'): void {
  const integrations = state.integrations.ws_01
  integrations.notion =
    status === 'not_connected'
      ? { status, display_name: null, connected_at: null }
      : { ...integrations.notion, status }
}

/** ws_01 의 태스크·이력·승인을 모두 비운다. 그 공간 추출 항목의 연결도 끊어 없는 태스크·승인을 가리키지 않게 한다 */
function clearTasks(state: MockDb): void {
  const taskIds = new Set(
    state.tasks
      .filter(({ workspace_id }) => workspace_id === 'ws_01')
      .map(({ task_id }) => task_id),
  )
  state.tasks = state.tasks.filter(({ task_id }) => !taskIds.has(task_id))
  state.taskHistory = state.taskHistory.filter(({ task_id }) => !taskIds.has(task_id))
  state.approvals = state.approvals.filter(({ workspace_id }) => workspace_id !== 'ws_01')
  const meetingIds = new Set(
    state.meetings
      .filter(({ workspace_id }) => workspace_id === 'ws_01')
      .map(({ meeting_id }) => meeting_id),
  )
  for (const extraction of state.extractions) {
    if (!meetingIds.has(extraction.meeting_id)) continue
    for (const item of extraction.items) {
      item.task_id = null
      item.approval_id = null
    }
  }
}

function approvalOf(state: MockDb, approvalId: string) {
  const approval = state.approvals.find(({ approval_id }) => approval_id === approvalId)
  if (!approval) throw new Error(`mock approval ${approvalId} is missing`)
  return approval
}

function taskOf(state: MockDb, taskId: string) {
  const task = state.tasks.find(({ task_id }) => task_id === taskId)
  if (!task) throw new Error(`mock task ${taskId} is missing`)
  return task
}

/** 처리자는 handler 와 같은 세션 팀원 mb_01 이다 (sessions.ts) */
function resolve(state: MockDb, approvalId: string, status: 'approved' | 'rejected'): void {
  const approval = approvalOf(state, approvalId)
  approval.status = status
  approval.resolved_by = 'mb_01'
  approval.resolved_at = MOCK_NOW
}

/**
 * ap_02(테스트 계획 정리, 마감 없음)를 마감을 보완해 승인한 결과. handler 의 승인 성공과 같은 모양이다 —
 * 태스크 하나, 생성 이력, 추출 항목 it_05 의 task_id. approval_id 는 남는다. Notion 은 연동돼 있어 pending 이다
 */
function resolvedCreateApproval(state: MockDb): void {
  const approval = approvalOf(state, 'ap_02')
  const task = createTask(
    {
      workspace_id: 'ws_01',
      meeting_id: 'mt_09',
      title: '테스트 계획 정리',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-26',
    },
    'mb_01',
    'meeting',
    state,
  )
  resolve(state, 'ap_02', 'approved')
  approval.related_task_id = task.task_id
  const item = state.extractions
    .flatMap(({ items }) => items)
    .find(({ item_id }) => item_id === approval.payload.extraction_item_id)
  if (item) item.task_id = task.task_id
}

/**
 * tk_01 의 상태를 todo → done 으로 바꾸자는 변경 승인. 제안할 때 본 값(base_values)은 todo 인데 지금은
 * in_progress 라 승인하면 409 APPROVAL_CONFLICT 다. progress 는 base 와 지금 값이 같아 충돌이 아니다
 */
function conflictingUpdateApproval(state: MockDb): void {
  state.approvals.push({
    approval_id: 'ap_04',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      status: 'done',
      progress: 100,
      base_values: { status: 'todo', progress: 40 },
      // 서버 수정안처럼 대상 태스크 이름을 표시용으로 싣는다
      base_title: '로그인 API 연동',
      task_title: '로그인 API 연동',
      meeting_id: 'mt_09',
      evidence_quote: '로그인 API 연동은 끝났어요.',
      evidence_speaker: '1123',
    },
    related_task_id: 'tk_01',
    requested_by: 'mb_02',
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-17T03:00:00Z',
    resolved_at: null,
  })
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
    case 'meeting-demo':
      // 브라우저 데모: 상세 조회(처리 화면 polling)마다 한 단계씩 보인다
      readyToUpload(state, 'staged')
      break
    case 'meeting-instant':
      // E2E: 업로드 뒤 첫 상세 조회에 정리가 끝난다
      readyToUpload(state, 'instant')
      break
    case 'meeting-fail':
      readyToUpload(state, 'fail')
      break
    case 'meeting-fail-notion-revoked':
      readyToUpload(state, 'fail-notion-revoked')
      break
    case 'meeting-notion-not-connected':
      readyToUpload(state, 'instant')
      setNotionStatus(state, 'not_connected')
      break
    case 'meeting-notion-revoked':
      readyToUpload(state, 'instant')
      setNotionStatus(state, 'revoked')
      break
    case 'meeting-member':
      // 일반 팀원. 처리 중인 mt_10 은 그대로 두고 첫 상세 조회에 끝나게 한다 — 정리 중·회의록 보기를 함께 본다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      setMeetingFlowMode('instant', state)
      break
    case 'tasks-default':
      // 픽스처 그대로의 정상 목록: 태스크 10개(반영 완료 2개), 보완이 필요한 대기 생성 승인 3개
      signInWith(state, ['ws_01'], 'ws_01')
      break
    case 'tasks-empty':
      signInWith(state, ['ws_01'], 'ws_01')
      clearTasks(state)
      break
    case 'approval-needs-input':
      // ap_01 의 제목·담당자·마감이 모두 비어 있다. 보완 없이는 400 이다
      signInWith(state, ['ws_01'], 'ws_01')
      Object.assign(approvalOf(state, 'ap_01').payload, {
        task_title: '',
        assignee_member_id: null,
        due_date: null,
      })
      break
    case 'approval-rejected':
      // 반려는 태스크를 만들지 않고 추출 항목도 그대로다
      signInWith(state, ['ws_01'], 'ws_01')
      resolve(state, 'ap_01', 'rejected')
      break
    case 'approval-resolved':
      signInWith(state, ['ws_01'], 'ws_01')
      resolvedCreateApproval(state)
      break
    case 'approval-conflict':
      signInWith(state, ['ws_01'], 'ws_01')
      conflictingUpdateApproval(state)
      break
    case 'notion-sync-pending':
      // tk_04 가 반영 대기다. synced 로 넘기는 워커는 없다 — 테스트가 필드를 직접 바꾼다
      signInWith(state, ['ws_01'], 'ws_01')
      taskOf(state, 'tk_04').notion_sync_status = 'pending'
      break
    case 'notion-sync-failed':
      // tk_04 가 반영 실패다. 재시도(POST /tasks/tk_04/notion-sync/retry)하면 pending 이 된다
      signInWith(state, ['ws_01'], 'ws_01')
      taskOf(state, 'tk_04').notion_sync_status = 'failed'
      break
    case 'tasks-member':
      // setMockRole('member') 와 같은 결과. 조회는 되고 쓰기는 403 이다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      break
  }
  return state
}

export function applyScenario(scenario: MockScenario): void {
  replaceDb(createScenarioDb(scenario))
}
