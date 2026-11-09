import { MEETING_FLOW_MODES, PASSWORD_RESET_FAILURES, db, initialDb, replaceDb } from './db'
import type { MockDb } from './db'

/*
 * 브라우저 MSW 전용 영속. 같은 탭의 새로고침과 OAuth 왕복(현재 탭 이동) 뒤에도 가입 계정·세션·
 * 워크스페이스·온보딩·연동·팀원 상태가 남게 한다. Vitest 는 쓰지 않는다 — 테스트마다 resetDb() 다.
 * 픽스처나 MockDb 모양을 바꾸면 버전을 올린다. 버전이 다른 저장값은 버리고 시작 상태로 돌아간다.
 * M5 에서 회의 정리 흐름(`meetingFlow`)과 그 생성 결과가 함께 남는다. 원본 음성 파일은 db 에 없어 저장되지 않는다.
 */

export const MOCK_DB_STORAGE_KEY = 'msw-db'
/**
 * 2: M5 의 `meetingFlow` 칸 추가. 3: M8 의 메시지 칸(`messageReviews`·`messageThreads`·`messageFailures`) 추가.
 * 4: M8 메시지를 디자인 캔버스대로 다시 만들며 검토·메시지 필드와 `messageFailures.actions` 추가.
 * 5: 재촉을 검토 행 하나로 두고 대화 메시지에서 발송 단계를 빼다.
 * 6: 팀원 초대(`invitations`) 칸 추가. 수락한 초대가 계정과 팀원을 잇는다.
 * 7: 메시지를 백엔드 계약 모양으로 옮겨 검토 행(`messageReviews`)을 보낼 메시지(`messageBundles`)로 바꾸다 (#315).
 * 8: 업로드 회의의 화자 지정(`meetingFlow.speakers`) 칸 추가 (#256).
 * 9: 비밀번호 재설정(`passwordReset`) 칸 추가 (#356). 모의 메일함의 메일이 새로고침·링크 열기 뒤에도 남는다.
 * 10: 메시지·알림 설정(`messageSettings`) 칸 추가 (#340).
 * 11: 리마인드에 취소 시각(`cancelled_at`) 칸 추가 (#370). 마지막 태스크를 빼 닫힌 묶음이 함께 취소된 것만 돌려준다.
 * 12: 계정에 공간별 팀원 행(`memberIds`) 칸 추가 (#367). 공간을 만든 계정이 새 PM 행과 이어진다.
 * 13: 되돌릴 자동 막힘(`autoBlocks`) 칸 추가 (#365). 응답의 `auto_blocked` 를 이력이 아니라 이 기록으로 판정한다.
 * 14: 리마인드 답장 판단(`replies`) 칸 추가 (#344). 태스크 고르기·태스크 기록·되돌리기가 이 기록을 읽는다.
 * 15: Discord 연동에 회의 채팅 채널(`chat_channel`)과 모의 서버의 텍스트 채널(`discordChannels`) 칸 추가 (#429).
 * 16: 로그인 시도 제한(`loginLimit`) 칸 추가 (#457).
 * 17: 가입 인증·카카오 대기(#427)와 별칭 후보(#523)가 각 브랜치에서 같은 버전 번호를 사용했다.
 * 18: 가입 인증·카카오 대기와 별칭 후보를 함께 저장한다. 서로 다른 17 저장본은 복원하지 않는다.
 * 19: 삭제된 회의의 원문 없는 삭제 기록을 저장한다 (#576).
 * 20: 계정 탈퇴의 익명 팀원과 개인정보 없는 정리 영수증을 저장한다 (#575).
 * 올리면 e2e/restore.e2e.ts 와 src/shared/mock/taskScenarios.test.ts 의 버전 단언도 같이 고친다 (E2E 는 src 를 가져오지 않는다)
 */
export const MOCK_DB_VERSION = 20

interface StoredDb {
  version: number
  db: MockDb
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'string')
}

function isSession(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value.user, ['user_id', 'email', 'name']) &&
    typeof value.workspace_count === 'number'
  )
}

function isMeetingFlow(value: unknown): boolean {
  return (
    isRecord(value) &&
    (MEETING_FLOW_MODES as readonly unknown[]).includes(value.mode) &&
    isRecord(value.attendees) &&
    Object.values(value.attendees).every(
      (ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
    ) &&
    isRecord(value.speakers) &&
    Object.values(value.speakers).every(
      (upload) => isRecord(upload) && Array.isArray(upload.speakers),
    )
  )
}

function isPasswordReset(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.tokens) &&
    value.tokens.every((token) => hasStrings(token, ['token', 'email', 'expiresAt', 'status'])) &&
    isRecord(value.nextMailAt) &&
    Array.isArray(value.outbox) &&
    value.outbox.every((mail) => hasStrings(mail, ['to', 'resetPath', 'sentAt'])) &&
    (PASSWORD_RESET_FAILURES as readonly unknown[]).includes(value.failure)
  )
}

function isSignupVerification(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.codes) &&
    isRecord(value.proofs) &&
    Array.isArray(value.outbox) &&
    value.outbox.every((mail) => hasStrings(mail, ['to', 'code', 'sentAt']))
  )
}

/**
 * 모양만 본다. 칸마다 시작 상태와 같은 종류(배열·객체·불리언)인지, 화면 흐름이 기대는 칸은
 * 필드까지 맞는지 확인한다. 하나라도 어긋나면 손상으로 본다.
 */
function isMockDb(value: unknown): value is MockDb {
  if (!isRecord(value)) return false
  const template = initialDb()
  for (const [key, expected] of Object.entries(template)) {
    const actual = value[key]
    if (Array.isArray(expected) ? !Array.isArray(actual) : typeof actual !== typeof expected)
      return false
    if (!Array.isArray(expected) && typeof expected === 'object' && !isRecord(actual)) return false
  }
  const state = value as unknown as MockDb
  return (
    isSession(state.session) &&
    state.withdrawnMemberIds.every((id) => typeof id === 'string') &&
    state.withdrawals.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.keyHash === 'string' &&
        isRecord(entry.receipt) &&
        hasStrings(entry.receipt, ['withdrawal_id', 'account_deleted_at']) &&
        (entry.receipt.cleanup_status === 'pending' ||
          entry.receipt.cleanup_status === 'complete') &&
        typeof entry.checks === 'number',
    ) &&
    state.meetingDeletions.every(
      (receipt) =>
        isRecord(receipt) &&
        hasStrings(receipt, ['meeting_id', 'workspace_id', 'deleted_at']) &&
        (receipt.cleanup_status === 'pending' || receipt.cleanup_status === 'complete') &&
        Array.isArray(receipt.deleted_meeting_ids) &&
        receipt.deleted_meeting_ids.every((id) => typeof id === 'string'),
    ) &&
    state.accounts.every(
      (account) =>
        isRecord(account) &&
        isSession(account.session) &&
        typeof account.password === 'string' &&
        Array.isArray(account.workspaceIds) &&
        isRecord(account.memberIds),
    ) &&
    state.workspaces.every(
      (workspace) =>
        hasStrings(workspace, ['workspace_id', 'name', 'created_at']) &&
        isRecord(workspace.onboarding) &&
        Array.isArray(workspace.onboarding.steps),
    ) &&
    state.members.every((member) => hasStrings(member, ['member_id', 'workspace_id'])) &&
    Object.values(state.integrations).every(
      (integration) =>
        hasStrings(integration.discord, ['status']) &&
        (integration.discord.chat_channel === null ||
          hasStrings(integration.discord.chat_channel, ['channel_id', 'name'])) &&
        hasStrings(integration.notion, ['status']),
    ) &&
    state.discordChannels.every((channel) =>
      hasStrings(channel, ['channel_id', 'name', 'access']),
    ) &&
    isMeetingFlow(state.meetingFlow) &&
    isPasswordReset(state.passwordReset) &&
    isSignupVerification(state.signupVerification) &&
    (state.kakao.pending === null || hasStrings(state.kakao.pending, ['kakaoId'])) &&
    Object.values(state.loginLimit).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.failures === 'number' &&
        typeof entry.windowStartedAt === 'number' &&
        (entry.blockedUntil === null || typeof entry.blockedUntil === 'number'),
    )
  )
}

/** 지금 상태를 쓴다. 저장소가 가득 찼거나 막혀 있으면 조용히 넘어간다 — 새로고침하면 시작 상태일 뿐이다 */
export function saveDb(storage: Storage): void {
  try {
    storage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION, db } satisfies StoredDb),
    )
  } catch {
    // 저장 실패는 개발용 모의 서버의 기능 저하일 뿐이다
  }
}

export function clearSavedDb(storage: Storage): void {
  try {
    storage.removeItem(MOCK_DB_STORAGE_KEY)
  } catch {
    // 막힌 저장소에는 지울 것도 없다
  }
}

/**
 * M6 S1 에서 Task 에 `version`·`notion_sync_status` 가 생겼다. 칸 모양은 그대로라 버전은 올리지 않는다.
 * 그 전에 저장된 태스크는 두 값이 없으므로 서버의 기본값(version 1, 미연동 null)으로 채워 복원한다.
 * 이미 있는 값은 건드리지 않는다
 */
function withTaskDefaults(state: MockDb): MockDb {
  for (const task of state.tasks as Partial<MockDb['tasks'][number]>[]) {
    if (!isRecord(task)) continue
    if (task.version === undefined) task.version = 1
    if (task.notion_sync_status === undefined) task.notion_sync_status = null
  }
  return state
}

/** 저장값을 읽는다. 없거나, 버전이 다르거나, 손상됐으면 지우고 null */
export function loadSavedDb(storage: Storage): MockDb | null {
  let raw: string | null
  try {
    raw = storage.getItem(MOCK_DB_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && parsed.version === MOCK_DB_VERSION && isMockDb(parsed.db))
      return withTaskDefaults(parsed.db)
  } catch {
    // JSON 이 아니다. 아래에서 지운다
  }
  clearSavedDb(storage)
  return null
}

/** 저장값이 쓸 만하면 db 에 덮어쓰고 true. 아니면 db 를 건드리지 않고 false */
export function restoreDb(storage: Storage): boolean {
  const saved = loadSavedDb(storage)
  if (saved === null) return false
  replaceDb(saved)
  return true
}
