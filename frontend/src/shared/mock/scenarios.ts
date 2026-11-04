import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { initialDb, replaceDb } from './db'
import type { MeetingFlowMode, MockDb, MockInvitation } from './db'
import { MOCK_NOW } from './fixtures/constants'
import {
  messagesMemberReview,
  messagesMemberThread,
  schedulePassedReview,
} from './fixtures/message'
import { completeMeeting, failMeeting, setMeetingFlowMode } from './meetingFlow'
import { notificationFixtures } from './fixtures/notification'
import { setMockRole } from './sessions'
import { blockBySilence, createTask } from './task-state'

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
  'meeting-fail-diarize',
  'meeting-fail-expired',
  'meeting-expired-member',
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
  // M8 태스크 보기(보드·캘린더·간트). ws_01 PM 이다
  'tasks-long-content',
  // M7 대시보드. 모두 ws_01 하나에 로그인한다(dashboard-member 만 일반 팀원). 처리 중 회의 mt_10 은 그대로라
  // 최신 완료 회의는 mt_09 이고 그 auto 항목이 it_01~it_03(tk_01~tk_03)이다
  'dashboard-default',
  'dashboard-no-meeting',
  'dashboard-notion-not-connected',
  'dashboard-no-auto',
  'dashboard-sync-pending',
  'dashboard-sync-failed',
  'dashboard-revert-rejected',
  'dashboard-member',
  'dashboard-partial-error',
  'dashboard-recent-overflow',
  // M8 메시지(임시, 디자인 캔버스 기준 MSW 목). 모두 ws_01 하나에 PM 으로 로그인한다.
  // 로딩은 시나리오가 아니라 응답을 붙잡아 재현한다. 발송 성공은 messages-default 로 본다 (계획 C-7)
  'messages-default',
  'messages-empty',
  'messages-list-error',
  'messages-thread-error',
  'messages-send-fail',
  'messages-member',
  'messages-schedule-passed',
  // M8-B 설정·팀 연결 관리. settings-discord-skipped 만 새로 만든 공간(ws_03)이고 나머지는 ws_01 이다
  'settings-discord-skipped',
  'settings-unmapped',
  'settings-member',
  // #330 알림·자동 막힘. ws_01 PM 이다
  'notifications-default',
  // #320 팀원 초대. team-invitations 는 ws_01 PM 이 보는 초대 상태, invitation-pending 은 초대받은 사람의 가입 전이다
  'team-invitations',
  'invitation-pending',
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

/**
 * 온보딩에서 Discord 연결과 팀원 연결을 건너뛰고 마친 PM 공간. Notion 만 연결했다.
 * 팀원은 생성자 PM 하나라 Discord 를 연결하면 사용자가 모두 미매핑이다
 */
const discordSkippedWorkspace: WorkspaceDto = {
  workspace_id: 'ws_03',
  name: '연결을 미룬 팀',
  role: 'pm',
  created_at: '2026-09-03T00:00:00Z',
  onboarding: {
    completed: true,
    current_step: null,
    steps: [
      { step: 'create_workspace', status: 'completed' },
      { step: 'connect_discord', status: 'skipped' },
      { step: 'connect_notion', status: 'completed' },
      { step: 'connect_members', status: 'skipped' },
    ],
  },
}

/** 새로 만든 공간을 넣는다. 백엔드처럼 생성자가 PM 팀원으로 있고 연동은 아직 없다 */
function addCreatedWorkspace(state: MockDb, workspace: WorkspaceDto): void {
  state.workspaces.push(structuredClone(workspace))
  state.members.push({
    member_id: 'mb_90',
    workspace_id: workspace.workspace_id,
    display_name: state.accounts[0].session.user.name,
    discord_user_id: null,
    notion_name: null,
    role: 'pm',
    created_at: MOCK_NOW,
  })
  state.integrations[workspace.workspace_id] = {
    discord: { status: 'not_connected', display_name: null, connected_at: null },
    notion: { status: 'not_connected', display_name: null, connected_at: null },
  }
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

function addLongContent(state: MockDb): void {
  const member = state.members.find(({ member_id }) => member_id === 'mb_03')
  if (member) member.display_name = '이재환프론트엔드디자인시스템접근성담당'
  const titles = [
    'https://notion.so/workspace/very-long-unbreakable-path-segment-for-task-board-layout-check-0123456789',
    '회의에서 나온 긴 제목의 태스크로 담당자와 마감일과 진행 상태을 모두 함께 보여 주어야 하는 경우의 줄바꿈 확인',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ]
  for (const [index, title] of titles.entries())
    createTask(
      {
        workspace_id: 'ws_01',
        title,
        assignee_member_id: index === 1 ? 'mb_01' : 'mb_03',
        status: (['todo', 'in_progress', 'blocked'] as const)[index],
        start_date: '2026-09-18',
        due_date: '2026-09-19',
      },
      null,
      'manual',
      state,
    )
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

function conflictingUpdateApproval(state: MockDb): void {
  state.approvals.push({
    approval_id: 'ap_04',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      status: 'done',
      base_values: { status: 'todo' },
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

/** 최근 반영의 세 태스크(tk_01~tk_03)를 모두 반영 완료로 둔다. 픽스처는 tk_01 만 synced 다 */
function syncRecentTasks(state: MockDb): void {
  for (const id of ['tk_01', 'tk_02', 'tk_03']) taskOf(state, id).notion_sync_status = 'synced'
}

/**
 * 최신 완료 회의의 추출(ex_01)에 첫 auto 항목(it_01, tk_01 반영 완료)의 사본을 붙여 auto 항목을 12개로 만든다.
 * 최근 반영이 첫 화면에 다 들어가지 않는 경우다 (D-176). 사본은 it_21 부터, 제목에 번호를 붙여 행을 구분한다
 */
function addRecentOverflow(state: MockDb): void {
  const extraction = state.extractions.find(({ extraction_id }) => extraction_id === 'ex_01')
  if (!extraction) throw new Error('mock extraction ex_01 is missing')
  const first = extraction.items.find(({ gate }) => gate === 'auto')
  if (!first) throw new Error('mock extraction ex_01 has no auto item')
  const autoCount = extraction.items.filter(({ gate }) => gate === 'auto').length
  for (let index = autoCount + 1; index <= 12; index += 1) {
    const copy = structuredClone(first)
    copy.item_id = `it_${20 + index - autoCount}`
    copy.task.title = `자동 반영 ${index}`
    extraction.items.push(copy)
  }
}

/** 그 회의를 회의 목록·상세·회의록·추출에서 뺀다. 정리 끝난 회의를 줄여 최신 완료 회의를 바꿀 때 쓴다 */
function removeMeeting(state: MockDb, meetingId: string): void {
  const extractionIds = new Set(
    state.meetings
      .filter(({ meeting_id }) => meeting_id === meetingId)
      .map(({ extraction_id }) => extraction_id),
  )
  state.meetings = state.meetings.filter(({ meeting_id }) => meeting_id !== meetingId)
  state.meetingSummaries = state.meetingSummaries.filter(
    ({ meeting_id }) => meeting_id !== meetingId,
  )
  state.minutes = state.minutes.filter(({ meeting_id }) => meeting_id !== meetingId)
  state.extractions = state.extractions.filter(
    ({ extraction_id }) => !extractionIds.has(extraction_id),
  )
}

/** ws_01 PM(us_01)이 보낸 초대. iv_02 는 이재환(mb_03)에게 jaehwan@example.com 으로 보낸 대기 초대다 */
function invitation(
  id: string,
  memberId: string,
  email: string,
  status: MockInvitation['status'],
  createdAt: string,
): MockInvitation {
  return {
    invitation_id: id,
    workspace_id: 'ws_01',
    member_id: memberId,
    email,
    status,
    invited_by_user_id: 'us_01',
    accepted_user_id: null,
    created_at: createdAt,
    responded_at: status === 'pending' ? null : createdAt.replace('T09', 'T10'),
  }
}

const pendingInvitation = () =>
  invitation('iv_02', 'mb_03', 'jaehwan@example.com', 'pending', '2026-09-16T09:00:00Z')

/**
 * 팀원마다 최근 초대가 다르다. 박민수(mb_02)는 us_02 가 수락했고, 이재환(mb_03)은 대기, 정하늘(mb_04)은 거절이다.
 * 이재환에게는 오타로 보냈다가 취소한 더 오래된 초대(iv_00)도 있다 — 화면은 최근 것만 본다
 */
function addTeamInvitations(state: MockDb): void {
  state.accounts.push({
    session: {
      user: { user_id: 'us_02', email: 'minsu@example.com', name: '박민수', avatar_url: null },
      workspace_count: 0,
      last_workspace_id: null,
    },
    password: 'mock-password',
    workspaceIds: [],
  })
  state.invitations.push(
    invitation('iv_00', 'mb_03', 'jaehwan@exmaple.com', 'canceled', '2026-09-14T09:00:00Z'),
    {
      ...invitation('iv_01', 'mb_02', 'minsu@example.com', 'accepted', '2026-09-15T09:00:00Z'),
      accepted_user_id: 'us_02',
    },
    pendingInvitation(),
    invitation('iv_03', 'mb_04', 'haneul@example.com', 'declined', '2026-09-17T09:00:00Z'),
  )
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
      addCreatedWorkspace(state, incompleteWorkspace)
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
    case 'meeting-fail-diarize':
      readyToUpload(state, 'fail-diarize')
      break
    case 'meeting-fail-expired':
      readyToUpload(state, 'fail-expired')
      break
    case 'meeting-expired-member':
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      failMeeting('mt_10', { failedStage: 'speaker_assignment_expired' }, state)
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
    case 'tasks-long-content':
      // 긴 제목·긴 담당자 이름·줄바꿈할 곳이 없는 문자열. 세 보기의 오늘(9/18) 근처 같은 날에 몰아 보기 폭을 시험한다
      signInWith(state, ['ws_01'], 'ws_01')
      addLongContent(state)
      break
    case 'dashboard-default':
      // 요약·확인 필요 3건·마감 임박 6건(전체 보기)·최근 반영 3건(모두 반영 완료, 되돌리기 가능)
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      break
    case 'dashboard-no-meeting':
      // 정리 끝난 회의가 없다(mt_10 은 정리 중). 최근 반영 빈 상태 ① → 회의 업로드
      signInWith(state, ['ws_01'], 'ws_01')
      removeMeeting(state, 'mt_07')
      removeMeeting(state, 'mt_09')
      break
    case 'dashboard-notion-not-connected':
      // 최근 반영 빈 상태 ② → Notion 설정. auto 항목이 있어도 Notion 이 먼저다
      signInWith(state, ['ws_01'], 'ws_01')
      setNotionStatus(state, 'not_connected')
      break
    case 'dashboard-no-auto':
      // 최신 완료 회의가 항목 0건인 mt_07 이다. 최근 반영 빈 상태 ③ → 최근 회의록
      signInWith(state, ['ws_01'], 'ws_01')
      removeMeeting(state, 'mt_09')
      break
    case 'dashboard-sync-pending':
      // tk_02 가 반영 대기다 — 대시보드가 3초마다 태스크 목록을 다시 받는다. synced 로 넘기는 워커는 없다
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      taskOf(state, 'tk_02').notion_sync_status = 'pending'
      break
    case 'dashboard-sync-failed':
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      taskOf(state, 'tk_02').notion_sync_status = 'failed'
      break
    case 'dashboard-revert-rejected':
      // tk_01 은 만든 뒤 바뀌어(version 2) task_changed, tk_02 는 대기 중인 변경 승인(ap_04 꼴)이 있어 pending_approval 이다.
      // tk_03 은 되돌릴 수 있다
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      taskOf(state, 'tk_01').version = 2
      state.approvals.push({
        approval_id: 'ap_05',
        workspace_id: 'ws_01',
        type: 'task_update',
        payload: {
          status: 'in_progress',
          base_values: { status: 'todo' },
          base_title: '회원가입 화면',
          task_title: '회원가입 화면',
          meeting_id: 'mt_09',
        },
        related_task_id: 'tk_02',
        requested_by: 'mb_02',
        status: 'pending',
        resolved_by: null,
        created_at: '2026-09-17T05:00:00Z',
        resolved_at: null,
      })
      break
    case 'dashboard-member':
      // 일반 팀원. 확인 대기 수·확인 필요 영역·되돌리기·PM 전용 이동이 없고 승인 목록을 부르지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      setMockRole('member', 'ws_01', state)
      break
    case 'dashboard-recent-overflow':
      // dashboard-default 에 최근 반영 auto 항목이 12개다 — 첫 화면에 들어가는 만큼 보이고 `외 N건` 이 회의록으로 간다 (D-176)
      signInWith(state, ['ws_01'], 'ws_01')
      syncRecentTasks(state)
      addRecentOverflow(state)
      break
    case 'dashboard-partial-error':
      // 최신 완료 회의(mt_09)의 추출이 없다 — 최근 반영만 조회 오류(404)이고 나머지 영역은 그대로다
      signInWith(state, ['ws_01'], 'ws_01')
      state.extractions = state.extractions.filter(({ extraction_id }) => extraction_id !== 'ex_01')
      break
    case 'messages-default':
      // 보내기 전 확인 2건(이재환 rv_01 은 마감 하루 전 예약, 정하늘 rv_02 는 지금 바로), 대화 4건 + 채널 1건.
      // 이재환 th_01 은 오늘로 3일째 답장이 없고 rv_01 이 그 대화에서 승인을 기다린다
      signInWith(state, ['ws_01'], 'ws_01')
      break
    case 'messages-empty':
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageReviews = state.messageReviews.filter(
        ({ workspace_id }) => workspace_id !== 'ws_01',
      )
      state.messageThreads = state.messageThreads.filter(
        ({ workspace_id }) => workspace_id !== 'ws_01',
      )
      break
    case 'messages-list-error':
      // 목록만 5xx 다. 대화 조회는 된다 — 대화 주소로 바로 들어오면 대화는 보인다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageFailures.inbox = true
      break
    case 'messages-thread-error':
      // 목록은 정상이고 이재환과의 대화(th_01)만 5xx 다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageFailures.threadIds = ['th_01']
      break
    case 'messages-send-fail':
      // 조회는 정상이고 발송·보내지 않음·고쳐 쓰기·발송 시점·답장·답장 판정만 5xx 다. db 는 바뀌지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageFailures.actions = true
      break
    case 'messages-member':
      // 일반 팀원(mb_01). 자기 대화 th_06 만 보이고, 그 대화의 승인 대기 rv_05 는 보이지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      state.messageThreads.push(structuredClone(messagesMemberThread))
      state.messageReviews.push(structuredClone(messagesMemberReview))
      break
    case 'messages-schedule-passed':
      // rv_06 은 마감 하루 전 시각이 이미 지났다. 마감은 오늘이라 만료가 아니고, 발송은 409 다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageReviews.push(structuredClone(schedulePassedReview))
      break
    case 'settings-discord-skipped':
      // 설정에서 Discord 를 연결한다. 연결해도 건너뜀으로 저장된 단계는 그대로다 (D-173)
      addCreatedWorkspace(state, discordSkippedWorkspace)
      state.integrations.ws_03.notion = {
        status: 'connected',
        display_name: 'Notion 연결됨',
        connected_at: MOCK_NOW,
      }
      signInWith(state, ['ws_03'], 'ws_03')
      break
    case 'settings-unmapped':
      // 픽스처 그대로의 ws_01 이다. Discord 연결됨, 1125(지훈)는 미매핑, mb_04 의 1126 은 서버를 떠났다(inactive), 1199 는 봇이다
      signInWith(state, ['ws_01'], 'ws_01')
      break
    case 'settings-member':
      // 일반 팀원. Discord 는 미연결(요청 안내), Notion 은 연결됨(PM 이 관리한다는 안내)이다. 연결·매핑 쓰기는 PM 만 한다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      state.integrations.ws_01.discord = {
        status: 'not_connected',
        display_name: null,
        connected_at: null,
      }
      break
    case 'notifications-default':
      // 안 읽은 알림 4건(모르는 종류 1건 포함)과 읽은 알림 1건. tk_06 은 무응답으로 자동 막혔다
      signInWith(state, ['ws_01'], 'ws_01')
      state.notifications = structuredClone(notificationFixtures)
      blockBySilence(taskOf(state, 'tk_06'), '2026-09-18T08:30:00+09:00', state)
      break
    case 'team-invitations':
      signInWith(state, ['ws_01'], 'ws_01')
      addTeamInvitations(state)
      break
    case 'invitation-pending':
      // 비로그인. jaehwan@example.com 으로 가입하면 iv_02 가 내 초대에 보인다
      state.authenticated = false
      state.invitations.push(pendingInvitation())
      break
  }
  return state
}

export function applyScenario(scenario: MockScenario): void {
  replaceDb(createScenarioDb(scenario))
}
