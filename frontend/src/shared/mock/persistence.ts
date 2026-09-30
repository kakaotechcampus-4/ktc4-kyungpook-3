import { db, initialDb, replaceDb } from './db'
import type { MockDb } from './db'

/*
 * 브라우저 MSW 전용 영속. 같은 탭의 새로고침과 OAuth 왕복(현재 탭 이동) 뒤에도 가입 계정·세션·
 * 워크스페이스·온보딩·연동·팀원 상태가 남게 한다. Vitest 는 쓰지 않는다 — 테스트마다 resetDb() 다.
 * 픽스처나 MockDb 모양을 바꾸면 버전을 올린다. 버전이 다른 저장값은 버리고 시작 상태로 돌아간다.
 */

export const MOCK_DB_STORAGE_KEY = 'msw-db'
export const MOCK_DB_VERSION = 1

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
    state.accounts.every(
      (account) =>
        isRecord(account) &&
        isSession(account.session) &&
        typeof account.password === 'string' &&
        Array.isArray(account.workspaceIds),
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
        hasStrings(integration.discord, ['status']) && hasStrings(integration.notion, ['status']),
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
      return parsed.db
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
