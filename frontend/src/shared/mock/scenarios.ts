import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { initialDb, replaceDb } from './db'
import type { MeetingFlowMode, MockDb, MockInvitation } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { LONG_ASR_CANDIDATE, LONG_ASR_WORD } from './fixtures/approval'
import {
  LONG_BUNDLE_BODY,
  LONG_RECIPIENT_NAME,
  LONG_UNBROKEN_URL,
  LONG_WORKSPACE_NAME,
  longConversation,
  mergeSourceBundle,
  messagesMemberBundle,
  messagesMemberThread,
  pmThreadMessages,
  reply,
  schedulePassedBundle,
  SECOND_PM,
} from './fixtures/message'
import { completeMeeting, failMeeting, setMeetingFlowMode, startChatMeeting } from './meetingFlow'
import { notificationFixtures } from './fixtures/notification'
import { largeProjectMap } from './fixtures/projectMap'
import { addReplyJudgments } from './fixtures/reply'
import { setMockRole } from './sessions'
import {
  PASSWORD_RESET_SCENARIOS,
  createPasswordResetScenarioDb,
  isPasswordResetScenario,
} from './passwordResetScenarios'
import { SPEAKER_SCENARIOS, createSpeakerScenarioDb, isSpeakerScenario } from './speakerScenarios'
import { blockBySilence, createTask } from './task-state'
import type { MockExtractionItem } from './aliasLearning'
import { mergeIntoApproval } from './approvalMerge'

/*
 * 브라우저·E2E 용 시작 상태. 모두 픽스처 계정 pm@example.com / mock-password 로 로그인한다.
 * 시나리오마다 initialDb() 에서 새로 만든다 — 앞 시나리오의 변경이 다음 시나리오에 남지 않는다.
 * Vitest 는 이 파일을 거치지 않는다. setup.ts 의 resetDb() 가 initialDb() 를 그대로 쓴다.
 */

export const MOCK_SCENARIOS = [
  'policy-reconsent',
  'consent-required',
  'consent-signup',
  'consent-agreed',
  'consent-mismatch',
  'consent-read-error',
  'consent-write-error',
  'consent-response-lost',
  'signed-out',
  // #457 비로그인이고 pm@example.com 이 로그인 시도 제한에 걸려 있다. 맞는 비밀번호도 429 다
  'login-rate-limited',
  'no-workspace',
  'single-workspace',
  'multiple-workspaces',
  'incomplete-workspace',
  // M5 회의 흐름. 모두 ws_01 하나에 로그인한다 — docs/impl-decision/2026-10-02-meeting-upload-policy.md
  'meeting-demo',
  // meeting-demo 와 같은 흐름을 #542 전 서버로 본다 — 상세에 processing 이 없어 진행 수·경과가 없다
  'meeting-demo-legacy',
  'meeting-instant',
  'meeting-fail',
  'meeting-fail-diarize',
  'meeting-fail-expired',
  'meeting-fail-unclaimed',
  'meeting-expired-member',
  // Notion 을 연결하지 않은 공간. 회의 올리기·정리·회의록·태스크를 그대로 쓴다 (D-182)
  'meeting-notion-not-connected',
  'meeting-member',
  // 정리 중 채팅 회의가 있는 업로드 (#450). 둘째는 그 회의가 첫 상세 조회에 chat_stalled 로 실패한다
  'meeting-chat-processing',
  'meeting-chat-stalled',
  // 정리 중 채팅 회의 mt_11 이 상세 조회마다 한 단계씩 간다 — 대화 모으기 → 뽑아내기 (#483)
  'meeting-chat-demo',
  ...SPEAKER_SCENARIOS,
  // M6 태스크·승인. 모두 ws_01 하나에 PM 으로 로그인한다(마지막만 일반 팀원). 전이는 handler 가 만든다
  'tasks-default',
  'tasks-empty',
  'approval-needs-input',
  'approval-rejected',
  'approval-resolved',
  'approval-conflict',
  'approval-scope',
  // #644 tk_04 의 마감을 없애자는 변경 승인 ap_09. payload 에 due_date 가 null 로 실린다 (backend-ai-contract update 마감 해제)
  'approval-due-clear',
  // #397 채팅 회의(mt_08)에서 나온 생성 승인 ap_07. 근거 시각이 실제 작성 시각이다
  'approval-chat',
  // #512 ap_03(배포 문서 보완)에 2주차 정기회의(mt_07)의 항목 it_21 이 합쳐져 담당자·마감이 바뀌었다
  'approval-merged',
  // #512 같은 합치기가 PM 이 카드를 연 뒤에 일어난다. 첫 승인·반려가 409 APPROVAL_CHANGED 다
  'approval-merged-after-view',
  // #643 생성 승인의 전사 오인식 의심. ap_01 은 고칠 후보, ap_02 는 확인 실패, ap_03 은 확인하지 않은 옛 카드(null)다
  'approval-asr-suspects',
  // #643 공백 없는 긴 의심 단어·후보. ap_02 는 빠진 값이 없어 대시보드도 의심 문구를 사유로 보인다
  'approval-asr-suspects-long',
  // #419 회의록 mt_09 의 수정 제안 it_08(tk_04 마감 변경). 승인 전에도 task_id 가 tk_04 다
  'minutes-edit-pending',
  // #551 mt_09 의 요약이 승인을 기다린다. 대기 카드 ap_01~ap_03 이라 PM 은 3건을 보고, -member 는 건수 없이 본다
  'minutes-awaiting-approval',
  'minutes-awaiting-approval-member',
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
  // #411 messages-member 에 서버 푸시 공개키를 더했다. 리마인드 대화 위 알림 띠가 보인다
  'messages-member-push',
  'messages-pm-self',
  'messages-schedule-passed',
  'messages-merge',
  'messages-long-content',
  // #519·#525 PM 이 웹에서 쓴 글. 다른 PM 의 글과 내 글, 웹 계정이 이어진 팀원(박민수)과 아닌 팀원(이재환)
  'messages-pm-thread',
  // M8-B 설정·팀 연결 관리. settings-discord-skipped 만 새로 만든 공간(ws_03)이고 나머지는 ws_01 이다
  'settings-discord-skipped',
  'settings-unmapped',
  // #660 settings-unmapped 에서 Discord 서버에 사용자가 아무도 없다 — 새로 만든 테스트 서버다. 아이디로 초대할 가입자가 있다
  'settings-discord-empty',
  'settings-member',
  // #330 알림·자동 막힘. ws_01 PM 이다
  'notifications-default',
  // #344 리마인드 답장 판단. reply-judgment 는 ws_01 PM, reply-judgment-member 는 같은 상태의 일반 팀원(mb_01)이다
  'reply-judgment',
  'reply-judgment-member',
  // #320 팀원 초대. team-invitations 는 ws_01 PM 이 보는 초대 상태, invitation-pending 은 초대받은 사람의 로그인 전이다
  'team-invitations',
  'invitation-pending',
  // #627 아이디. username-taken 은 비로그인이고 박민수(minsu)가 가입해 있다. username-race 는 비로그인이고
  // newuser1 을 중복 확인하면 쓸 수 있다고 답하지만 가입·아이디 변경은 409 USERNAME_TAKEN 이다(확인 뒤 남이 가져감).
  // kakao-account 는 이메일·비밀번호 없이 카카오로 가입한 계정(userpm, 최진호)으로 ws_01 PM 에 로그인한다
  'username-taken',
  'username-race',
  'kakao-account',
  // #551 프로젝트 맵. ws_01 PM 이다. no-topics 는 요약 전이라 주제·결정이 없고 태스크끼리의 선만 있다.
  // empty 는 태스크도 주제도 없다. large 는 픽스처에 주제 36 · 태스크 500 · 선 1,173 을 더한다(브라우저 성능 확인용)
  'project-map-no-topics',
  'project-map-empty',
  'project-map-large',
  // #356 비밀번호 재설정. 모두 비로그인이다
  ...PASSWORD_RESET_SCENARIOS,
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
    has_login_account: false,
    created_at: MOCK_NOW,
  })
  state.integrations[workspace.workspace_id] = {
    discord: {
      status: 'not_connected',
      display_name: null,
      connected_at: null,
      chat_channel: null,
    },
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

function disconnectNotion(state: MockDb): void {
  state.integrations.ws_01.notion = {
    status: 'not_connected',
    display_name: null,
    connected_at: null,
  }
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

function addLongMessages(state: MockDb): void {
  const workspace = state.workspaces.find(({ workspace_id }) => workspace_id === 'ws_01')
  const bundle = state.messageBundles.find(({ bundle_id }) => bundle_id === 'bd_01')
  const thread = state.messageThreads.find(({ thread_id }) => thread_id === 'th_01')
  const longThread = state.messageThreads.find(({ thread_id }) => thread_id === 'th_02')
  if (!workspace || !bundle || !thread || !longThread)
    throw new Error('mock ws_01, bundle bd_01 or thread th_01·th_02 is missing')
  workspace.name = LONG_WORKSPACE_NAME
  bundle.recipient_name = LONG_RECIPIENT_NAME
  bundle.body = LONG_BUNDLE_BODY
  bundle.reminders[0].note = `링크 남겨요 ${LONG_UNBROKEN_URL}`
  thread.name = LONG_RECIPIENT_NAME
  thread.messages.push(
    reply('mg_80', `링크 남겨요\n${LONG_UNBROKEN_URL}`, '2026-09-16T19:00:00+09:00'),
  )
  longThread.messages.push(...structuredClone(longConversation))
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

/** 요약을 아직 만들지 않았다. 남은 건수는 minutes handler 가 지금 대기 카드로 센다 */
function awaitApprovalSummary(state: MockDb, meetingId: string): void {
  const minutes = state.minutes.find(({ meeting_id }) => meeting_id === meetingId)
  if (!minutes) throw new Error(`mock minutes ${meetingId} is missing`)
  minutes.summary = null
  minutes.summary_status = 'awaiting_approval'
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
 * 2주차 정기회의(mt_07) 항목 it_21. 같은 일(배포 문서)을 이재환에게 26일까지 맡긴다. ap_03 에 합쳐지면
 * 담당자를 정한 항목(`assignee_item_id`)이 된다. `afterView` 면 합치지 않고 처리 요청 직전에 합쳐지게 둔다
 */
function mergeIntoDeployDoc(state: MockDb, afterView: boolean): void {
  const item: MockExtractionItem = {
    item_id: 'it_21',
    task: { title: '배포 문서 마무리', confidence: 0.9 },
    assignee: {
      raw: '재환',
      member_id: 'mb_03',
      display_name: '이재환',
      confidence: 0.9,
      needs_check: false,
    },
    due_date: { value: '2026-09-26', raw: '26일', confidence: 0.9 },
    confidence: 0.85,
    gate: 'review',
    evidence: {
      quote: '배포 문서는 재환님이 26일까지 마무리해 주세요.',
      speaker: '1123',
      speaker_member_id: 'mb_01',
      at_ms: 1_250_000,
    },
    reverted_at: null,
    task_id: null,
    approval_id: null,
    approval_status: null,
    alias_candidate: false,
    alias_text: null,
  }
  const extraction = state.extractions.find(({ meeting_id }) => meeting_id === 'mt_07')
  if (!extraction) throw new Error('mock extraction for mt_07 is missing')
  extraction.items.push(item)
  const facts = { category: 'assignee', status: null, docText: null }
  if (afterView) item.merge_into = { approval_id: 'ap_03', ...facts }
  else mergeIntoApproval(approvalOf(state, 'ap_03'), 'mt_07', item, facts, '2026-09-17T03:00:00Z')
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
    alias_candidate: false,
    alias_text: null,
  })
}

/**
 * 범위 변경(category scope) 변경 승인 둘과 승인된 범위 변경 이력 하나 (#205). ap_05 는 바꿀 필드가 없고,
 * ap_06 은 마감 변경이 함께 왔다. 이력 모양은 BE 미구현이라 #205 합의를 따른다
 */
function addScopeChanges(state: MockDb): void {
  const login = taskOf(state, 'tk_01')
  const signup = taskOf(state, 'tk_02')
  const proposals = [
    {
      id: 'ap_05',
      task: login,
      fields: {},
      baseValues: {},
      docText: '소셜 로그인은 이번 범위에서 빼기로 했어요.',
      quote: '소셜 로그인은 이번엔 빼기로 했어요.',
      createdAt: '2026-09-17T03:00:00Z',
    },
    {
      id: 'ap_06',
      task: signup,
      fields: { due_date: '2026-09-25' },
      baseValues: { due_date: signup.due_date },
      docText: '회원가입은 이메일 인증까지만 하고 마감을 25일로 미뤄요.',
      quote: '회원가입은 이메일 인증까지만 하고 25일까지 할게요.',
      createdAt: '2026-09-17T03:05:00Z',
    },
  ]
  for (const { id, task, fields, baseValues, docText, quote, createdAt } of proposals)
    state.approvals.push({
      approval_id: id,
      workspace_id: 'ws_01',
      type: 'task_update',
      payload: {
        ...fields,
        base_values: baseValues,
        base_task_version: task.version,
        base_title: task.title,
        task_title: task.title,
        doc_text: docText,
        category: 'scope',
        evidence_quote: quote,
        evidence_speaker: '1124',
        evidence_speaker_member_id: 'mb_02',
        evidence_at_ms: 754_000,
        meeting_id: 'mt_09',
        gate: 'review',
      },
      related_task_id: task.task_id,
      requested_by: null,
      status: 'pending',
      resolved_by: null,
      created_at: createdAt,
      resolved_at: null,
      alias_candidate: false,
      alias_text: null,
    })
  state.taskHistory.push({
    history_id: 'hs_03',
    task_id: login.task_id,
    changed_field: 'scope',
    old_value: null,
    new_value: '비밀번호 찾기는 다음 스프린트로 넘기기로 했어요.',
    change_source: 'meeting',
    changed_by: 'mb_01',
    is_auto: false,
    is_rolled_back: false,
    rolled_back_at: null,
    created_at: '2026-09-17T02:00:00Z',
  })
}

function addDueClearProposal(state: MockDb): void {
  const task = taskOf(state, 'tk_04')
  state.approvals.push({
    approval_id: 'ap_09',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      due_date: null,
      base_values: { due_date: task.due_date },
      base_task_version: task.version,
      base_title: task.title,
      task_title: task.title,
      evidence_quote: '배포 스크립트는 날짜를 아직 못 박겠어요.',
      evidence_speaker: '1123',
      evidence_speaker_member_id: 'mb_01',
      evidence_at_ms: 412_000,
      meeting_id: 'mt_09',
      gate: 'review',
    },
    related_task_id: task.task_id,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-17T04:10:00Z',
    resolved_at: null,
    alias_candidate: false,
    alias_text: null,
  })
}

/**
 * 회의 mt_09 에서 나온 수정 제안. 백엔드 수정 항목처럼 추출 항목의 task_id 는 승인 전에도 대상 태스크 tk_04 이고,
 * 반영 여부는 조회 handler 가 채우는 approval_status 로만 알 수 있다 (#419)
 */
function addEditProposal(state: MockDb): void {
  const task = taskOf(state, 'tk_04')
  const extraction = state.extractions.find(({ extraction_id }) => extraction_id === 'ex_01')
  if (!extraction) throw new Error('mock extraction ex_01 is missing')
  const quote = '배포 스크립트는 26일까지로 미룰게요.'
  extraction.items.push({
    item_id: 'it_08',
    task: { title: task.title, confidence: 0.9 },
    assignee: {
      raw: '김서연',
      member_id: 'mb_01',
      display_name: '김서연',
      confidence: 0.95,
      needs_check: false,
    },
    due_date: { value: '2026-09-26', raw: '26일', confidence: 0.9 },
    confidence: 0.9,
    gate: 'review',
    evidence: { quote, speaker: '1123', speaker_member_id: 'mb_01', at_ms: 190_000 },
    reverted_at: null,
    task_id: task.task_id,
    approval_id: 'ap_08',
    approval_status: 'pending',
    alias_candidate: false,
    alias_text: null,
  })
  state.approvals.push({
    approval_id: 'ap_08',
    workspace_id: 'ws_01',
    type: 'task_update',
    payload: {
      due_date: '2026-09-26',
      base_values: { due_date: task.due_date },
      base_task_version: task.version,
      base_title: task.title,
      task_title: task.title,
      due_raw: '26일',
      evidence_quote: quote,
      evidence_speaker: '1123',
      evidence_speaker_member_id: 'mb_01',
      evidence_at_ms: 190_000,
      extraction_item_id: 'it_08',
      meeting_id: 'mt_09',
      gate: 'review',
    },
    related_task_id: task.task_id,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-17T04:00:00Z',
    resolved_at: null,
    alias_candidate: false,
    alias_text: null,
  })
}

/**
 * 채팅 회의 mt_08 에서 나온 생성 승인 (#378). 근거 오프셋 34_080_000 은 첫 메시지부터 9시간 28분 뒤라
 * 녹음 위치로 읽으면 `9:28:00`, 실제 작성 시각으로 읽으면 `09/11 18:40` 이다 (#397)
 */
function addChatApproval(state: MockDb): void {
  state.approvals.push({
    approval_id: 'ap_07',
    workspace_id: 'ws_01',
    type: 'task_create',
    payload: {
      task_title: '배포 체크리스트 정리',
      assignee_member_id: 'mb_03',
      assignee_raw: '재환',
      due_date: null,
      due_raw: '배포 전',
      evidence_quote: '배포 체크리스트는 재환님이 배포 전에 정리해 주세요.',
      evidence_speaker: '1123',
      evidence_speaker_member_id: 'mb_01',
      evidence_at_ms: 34_080_000,
      meeting_id: 'mt_08',
      gate: 'review',
    },
    related_task_id: null,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: '2026-09-12T00:03:00Z',
    resolved_at: null,
    alias_candidate: false,
    alias_text: null,
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

/** ws_01 PM(us_01)이 보낸 초대. iv_02 는 이재환(mb_03)에게 그 사람 계정(us_03)으로 보낸 대기 초대다 */
function invitation(
  id: string,
  memberId: string,
  invitedUserId: string,
  status: MockInvitation['status'],
  createdAt: string,
): MockInvitation {
  return {
    invitation_id: id,
    workspace_id: 'ws_01',
    member_id: memberId,
    invited_user_id: invitedUserId,
    status,
    invited_by_user_id: 'us_01',
    accepted_user_id: null,
    created_at: createdAt,
    responded_at: status === 'pending' ? null : createdAt.replace('T09', 'T10'),
  }
}

const pendingInvitation = () =>
  invitation('iv_02', 'mb_03', 'us_03', 'pending', '2026-09-16T09:00:00Z')

const acceptedByMinsu = (): MockInvitation => ({
  ...invitation('iv_01', 'mb_02', 'us_02', 'accepted', '2026-09-15T09:00:00Z'),
  accepted_user_id: 'us_02',
})

/** 어느 공간에도 직접 속하지 않은 가입자. 비밀번호는 픽스처 계정과 같다 */
function addAccount(
  state: MockDb,
  user: { user_id: string; username: string; email: string; name: string },
): void {
  state.accounts.push({
    session: {
      user: { ...user, avatar_url: null },
      workspace_count: 0,
      last_workspace_id: null,
    },
    password: 'mock-password',
    workspaceIds: [],
    memberIds: {},
  })
}

/** 박민수(us_02, 아이디 minsu). 어느 공간에도 직접 속하지 않는다 */
function addMinsuAccount(state: MockDb): void {
  addAccount(state, {
    user_id: 'us_02',
    username: 'minsu',
    email: 'minsu@example.com',
    name: '박민수',
  })
}

/**
 * 초대에 쓰는 가입자. 박민수(us_02, minsu), 이재환(us_03, jaehwan), 정하늘(us_04, haneul),
 * 한도윤(us_05, doyun). 한도윤은 어느 팀원과도 이어지지 않아 아이디로 찾아 초대할 수 있다
 */
function addInviteeAccounts(state: MockDb): void {
  addMinsuAccount(state)
  addAccount(state, {
    user_id: 'us_03',
    username: 'jaehwan',
    email: 'jaehwan@example.com',
    name: '이재환',
  })
  addAccount(state, {
    user_id: 'us_04',
    username: 'haneul',
    email: 'haneul@example.com',
    name: '정하늘',
  })
  addAccount(state, {
    user_id: 'us_05',
    username: 'doyun',
    email: 'doyun@example.com',
    name: '한도윤',
  })
}

/**
 * 팀원마다 최근 초대가 다르다. 박민수(mb_02)는 us_02 가 수락했고, 이재환(mb_03)은 대기, 정하늘(mb_04)은 거절이다.
 * 이재환에게는 다른 사람(한도윤)을 잘못 골라 보냈다가 취소한 더 오래된 초대(iv_00)도 있다 — 화면은 최근 것만 본다
 */
function addTeamInvitations(state: MockDb): void {
  addInviteeAccounts(state)
  state.invitations.push(
    invitation('iv_00', 'mb_03', 'us_05', 'canceled', '2026-09-14T09:00:00Z'),
    acceptedByMinsu(),
    pendingInvitation(),
    invitation('iv_03', 'mb_04', 'us_04', 'declined', '2026-09-17T09:00:00Z'),
  )
}

export function createScenarioDb(scenario: MockScenario): MockDb {
  if (isSpeakerScenario(scenario)) return createSpeakerScenarioDb(scenario)
  if (isPasswordResetScenario(scenario)) return createPasswordResetScenarioDb(scenario)
  const state = initialDb()
  switch (scenario) {
    case 'policy-reconsent':
      signInWith(state, ['ws_01'], 'ws_01')
      state.consents = state.consents.map((row) => ({ ...row, version: '2026-11-08' }))
      break
    case 'consent-required':
    case 'consent-signup':
    case 'consent-agreed':
    case 'consent-mismatch':
    case 'consent-read-error':
    case 'consent-write-error':
    case 'consent-response-lost':
      signInWith(state, ['ws_01'], 'ws_01')
      state.consentVersions = { terms: 'test-terms-v1', privacy: 'test-privacy-v1' }
      state.consents = []
      if (scenario === 'consent-signup') state.authenticated = false
      if (scenario === 'consent-mismatch') state.consentVersions.terms = 'server-new-terms'
      if (scenario === 'consent-read-error') state.consentFailure = 'read'
      if (scenario === 'consent-write-error') state.consentFailure = 'write'
      if (scenario === 'consent-response-lost') state.consentFailure = 'response-lost'
      if (scenario === 'consent-agreed')
        state.consents = (['terms', 'privacy'] as const).map((kind) => ({
          user_id: state.session.user.user_id,
          kind,
          version: state.consentVersions[kind],
          agreed_at: MOCK_NOW,
        }))
      break
    case 'signed-out':
      state.authenticated = false
      break
    case 'login-rate-limited':
      state.authenticated = false
      // 같은 시나리오는 늘 같은 db 여야 해서 지금 시각이 아니라 고정 시각까지 막는다
      state.loginLimit['pm@example.com'] = {
        failures: 10,
        windowStartedAt: Date.parse('2099-12-30T23:45:00.000Z'),
        blockedUntil: Date.parse('2099-12-31T00:00:00.000Z'),
      }
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
    case 'meeting-demo-legacy':
      readyToUpload(state, 'staged-legacy')
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
    case 'meeting-fail-unclaimed':
      readyToUpload(state, 'fail-unclaimed')
      break
    case 'meeting-expired-member':
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      failMeeting('mt_10', { failedStage: 'speaker_assignment_expired' }, state)
      break
    case 'meeting-notion-not-connected':
      readyToUpload(state, 'instant')
      disconnectNotion(state)
      break
    case 'meeting-member':
      // 일반 팀원. 처리 중인 mt_10 은 그대로 두고 첫 상세 조회에 끝나게 한다 — 정리 중·회의록 보기를 함께 본다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      setMeetingFlowMode('instant', state)
      break
    case 'meeting-chat-processing':
      readyToUpload(state, 'manual')
      startChatMeeting(state)
      break
    case 'meeting-chat-stalled':
      readyToUpload(state, 'fail-chat-stalled')
      startChatMeeting(state)
      break
    case 'meeting-chat-demo':
      readyToUpload(state, 'staged')
      startChatMeeting(state)
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
    case 'approval-scope':
      signInWith(state, ['ws_01'], 'ws_01')
      addScopeChanges(state)
      break
    case 'approval-due-clear':
      signInWith(state, ['ws_01'], 'ws_01')
      addDueClearProposal(state)
      break
    case 'approval-chat':
      signInWith(state, ['ws_01'], 'ws_01')
      addChatApproval(state)
      break
    case 'approval-merged':
    case 'approval-merged-after-view':
      signInWith(state, ['ws_01'], 'ws_01')
      mergeIntoDeployDoc(state, scenario === 'approval-merged-after-view')
      break
    case 'approval-asr-suspects':
      signInWith(state, ['ws_01'], 'ws_01')
      approvalOf(state, 'ap_01').payload.asr_suspects = [
        { word: '애포', source: 'title', candidates: ['배포'] },
      ]
      approvalOf(state, 'ap_02').payload.asr_suspects = [
        { word: '', source: 'check_failed', candidates: [] },
      ]
      approvalOf(state, 'ap_03').payload.asr_suspects = null
      break
    case 'approval-asr-suspects-long':
      signInWith(state, ['ws_01'], 'ws_01')
      approvalOf(state, 'ap_01').payload.asr_suspects = [
        { word: '애포', source: 'title', candidates: [LONG_ASR_CANDIDATE] },
      ]
      Object.assign(approvalOf(state, 'ap_02').payload, {
        due_date: '2026-09-30',
        asr_suspects: [
          { word: LONG_ASR_WORD, source: 'title', candidates: [LONG_ASR_CANDIDATE, '배포'] },
        ],
      })
      break
    case 'minutes-edit-pending':
      signInWith(state, ['ws_01'], 'ws_01')
      addEditProposal(state)
      break
    case 'minutes-awaiting-approval':
    case 'minutes-awaiting-approval-member':
      signInWith(state, ['ws_01'], 'ws_01')
      awaitApprovalSummary(state, 'mt_09')
      if (scenario === 'minutes-awaiting-approval-member') setMockRole('member', 'ws_01', state)
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
      removeMeeting(state, 'mt_08')
      removeMeeting(state, 'mt_09')
      break
    case 'dashboard-notion-not-connected':
      // 최근 반영 빈 상태 ② → Notion 설정. auto 항목이 있어도 Notion 이 먼저다
      signInWith(state, ['ws_01'], 'ws_01')
      disconnectNotion(state)
      break
    case 'dashboard-no-auto':
      // 최신 완료 회의가 항목 0건인 mt_07 이다. 최근 반영 빈 상태 ③ → 최근 회의록
      signInWith(state, ['ws_01'], 'ws_01')
      removeMeeting(state, 'mt_08')
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
        alias_candidate: false,
        alias_text: null,
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
      // 보낼 메시지 2통(이재환 bd_01 은 마감 하루 전, 정하늘 bd_02 는 직접 정한 시각이고 AI 초안을 기다린다), 대화 4건.
      // 이재환 th_01 은 오늘로 3일째 답장이 없고 bd_01 이 그 대화에서 승인을 기다린다. 박지훈에게 마지막으로 보낸 DM 은 가지 못했다.
      // bd_01 의 태스크 tk_04 는 9/17 에 진행 중으로 바뀌어, 재촉 이유의 근거가 그 변경이다(변경 보기)
      signInWith(state, ['ws_01'], 'ws_01')
      state.taskHistory.push({
        history_id: 'hs_m1',
        task_id: 'tk_04',
        changed_field: 'status',
        old_value: 'todo',
        new_value: 'in_progress',
        change_source: 'manual',
        changed_by: 'mb_01',
        is_auto: false,
        is_rolled_back: false,
        rolled_back_at: null,
        created_at: '2026-09-17T06:00:00Z',
      })
      break
    case 'messages-empty':
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageBundles = state.messageBundles.filter(
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
      // 조회는 정상이고 승인·보내지 않음·문구·시각 고치기·답장만 5xx 다. db 는 바뀌지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageFailures.actions = true
      break
    case 'messages-member':
    case 'messages-member-push':
      // 일반 팀원(mb_01). 자기 대화 th_06 만 보이고, 그 대화의 보낼 메시지 bd_05 는 보이지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      state.messageThreads.push(structuredClone(messagesMemberThread))
      state.messageBundles.push(structuredClone(messagesMemberBundle))
      if (scenario === 'messages-member-push') state.push.publicKey = 'AQID'
      break
    case 'messages-pm-self':
      // PM 인 픽스처 계정도 팀원 행(mb_01)이 있어 자기 대화 th_06 이 남의 대화들 사이에 있다. 답장은 th_06 에만 된다 (#367)
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageThreads.push(structuredClone(messagesMemberThread))
      state.messageBundles.push(structuredClone(messagesMemberBundle))
      break
    case 'messages-schedule-passed':
      // bd_06 은 승인하지 않은 채 보낼 시각(마감 하루 전)이 지났다. 마감은 오늘이라 만료가 아니고, 승인은 409 다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageBundles.push(structuredClone(schedulePassedBundle))
      break
    case 'messages-merge':
      // 이재환의 bd_07 을 마감 하루 전으로 옮기면 승인해 둔 bd_01 과 같은 시각이라 합쳐지고 bd_01 의 승인이 풀린다
      signInWith(state, ['ws_01'], 'ws_01')
      state.messageBundles = state.messageBundles.map((bundle) =>
        bundle.bundle_id === 'bd_01'
          ? { ...bundle, approved: true, approved_at: '2026-09-17T10:00:00+09:00' }
          : bundle,
      )
      state.messageBundles.push(structuredClone(mergeSourceBundle))
      break
    case 'messages-pm-thread':
      // 두 번째 PM 오지현(mb_06)이 이재환(th_01)에게 쓴 글은 Discord 가 없어 가지 못했다. 김서연(mb_01)은 박민수(th_02)에게 썼다.
      // 박민수만 초대를 수락해 웹 계정이 이어졌다 — 이재환은 웹 답장 불가다
      signInWith(state, ['ws_01'], 'ws_01')
      state.members.push({
        ...SECOND_PM,
        workspace_id: 'ws_01',
        notion_name: null,
        role: 'pm',
        has_login_account: true,
        created_at: '2026-09-02T00:00:00Z',
      })
      for (const { thread_id, message } of pmThreadMessages)
        state.messageThreads
          .find((thread) => thread.thread_id === thread_id)
          ?.messages.push(structuredClone(message))
      addMinsuAccount(state)
      state.invitations.push(acceptedByMinsu())
      break
    case 'messages-long-content':
      // messages-default 에 긴 문구를 더한다. 공간(봇) 이름과 이재환(bd_01·th_01)의 이름이 띄어 쓰지 않은 긴 이름이고,
      // bd_01 은 여러 줄 본문 끝에 줄바꿈할 곳이 없는 주소가 있다. th_01 에는 그 주소의 답장, th_02(박민수)에는 며칠에 걸친 30통이 더 있다
      signInWith(state, ['ws_01'], 'ws_01')
      addLongMessages(state)
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
    case 'settings-discord-empty':
      signInWith(state, ['ws_01'], 'ws_01')
      state.discordUsers = []
      addInviteeAccounts(state)
      break
    case 'settings-member':
      // 일반 팀원. Discord 는 미연결(요청 안내), Notion 은 연결됨(PM 이 관리한다는 안내)이다. 연결·매핑 쓰기는 PM 만 한다
      signInWith(state, ['ws_01'], 'ws_01')
      setMockRole('member', 'ws_01', state)
      state.integrations.ws_01.discord = {
        status: 'not_connected',
        display_name: null,
        connected_at: null,
        chat_channel: null,
      }
      break
    case 'notifications-default':
      // 안 읽은 알림 4건(모르는 종류 1건 포함)과 읽은 알림 1건. tk_06 은 무응답으로 자동 막혔다
      signInWith(state, ['ws_01'], 'ws_01')
      state.notifications = structuredClone(notificationFixtures)
      blockBySilence(taskOf(state, 'tk_06'), '2026-09-18T08:30:00+09:00', state)
      break
    case 'reply-judgment':
    case 'reply-judgment-member':
      // 박민수 th_02 의 답장은 PM 이 태스크를 고를 차례다. 이재환 th_01 의 새 답장이 tk_03 을 완료로 바꿨고(되돌리기),
      // tk_03 마감·tk_08 담당자 승인 카드 ap_31·ap_32 를 남겼다. 팀원에게는 답장 글이 보이지 않는다
      signInWith(state, ['ws_01'], 'ws_01')
      addReplyJudgments(state)
      if (scenario === 'reply-judgment-member') setMockRole('member', 'ws_01', state)
      break
    case 'team-invitations':
      signInWith(state, ['ws_01'], 'ws_01')
      addTeamInvitations(state)
      break
    case 'username-taken':
      state.authenticated = false
      addMinsuAccount(state)
      break
    case 'username-race':
      state.authenticated = false
      state.usernameRace = ['newuser1']
      break
    case 'kakao-account':
      signInWith(state, ['ws_01'], 'ws_01')
      for (const user of [state.session.user, state.accounts[0].session.user]) user.email = null
      state.accounts[0].password = null
      break
    case 'project-map-no-topics':
      signInWith(state, ['ws_01'], 'ws_01')
      state.projectMap.topics = []
      state.projectMap.decisions = []
      break
    case 'project-map-empty':
      signInWith(state, ['ws_01'], 'ws_01')
      clearTasks(state)
      state.projectMap = { topics: [], decisions: [], taskLinks: [] }
      break
    case 'project-map-large': {
      signInWith(state, ['ws_01'], 'ws_01')
      // 픽스처 태스크·주제는 승인·회의록이 가리키므로 남기고 그 위에 더한다
      const large = largeProjectMap()
      state.tasks.push(...large.tasks)
      state.projectMap.topics.push(...large.projectMap.topics)
      state.projectMap.taskLinks.push(...large.projectMap.taskLinks)
      break
    }
    case 'invitation-pending':
      // 비로그인. 이재환(jaehwan@example.com, mock-password)으로 로그인하면 iv_02 가 내 초대에 보인다
      state.authenticated = false
      addInviteeAccounts(state)
      state.invitations.push(pendingInvitation())
      break
  }
  if (!scenario.startsWith('consent-') && scenario !== 'policy-reconsent') {
    for (const account of state.accounts) {
      for (const kind of ['terms', 'privacy'] as const) {
        if (
          !state.consents.some(
            (row) => row.user_id === account.session.user.user_id && row.kind === kind,
          )
        ) {
          state.consents.push({
            user_id: account.session.user.user_id,
            kind,
            version: state.consentVersions[kind],
            agreed_at: MOCK_NOW,
          })
        }
      }
    }
  }
  return state
}

export function applyScenario(scenario: MockScenario): void {
  replaceDb(createScenarioDb(scenario))
}
