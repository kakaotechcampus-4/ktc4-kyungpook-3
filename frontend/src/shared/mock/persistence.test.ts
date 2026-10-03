import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { SessionDto } from '@/shared/types/api/auth'
import type { ListDto } from '@/shared/types/api/envelope'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { MemberDto } from '@/shared/types/api/member'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb, resetDb } from './db'
import { settleMockOAuth } from './oauth/mockOAuth'
import {
  MOCK_DB_STORAGE_KEY,
  MOCK_DB_VERSION,
  clearSavedDb,
  loadSavedDb,
  restoreDb,
  saveDb,
} from './persistence'

afterEach(() => {
  sessionStorage.clear()
})

/** 가입부터 팀원 연결까지 한 번씩 바꾼다. 새로고침 뒤에 이 상태가 남아야 한다 */
async function walkThroughOnboarding(): Promise<string> {
  await fetchDto(
    '/auth/signup',
    jsonRequest('POST', { email: 'new@example.com', password: 'pass1234', name: '새 사용자' }),
  )
  const { workspace_id } = await fetchDto<WorkspaceDto>(
    '/workspaces',
    jsonRequest('POST', { name: '새 팀' }),
  )
  await fetchDto(
    `/workspaces/${workspace_id}/onboarding`,
    jsonRequest('PATCH', { step: 'create_workspace', action: 'complete' }),
  )
  settleMockOAuth({ workspaceId: workspace_id, provider: 'discord', outcome: 'success' })
  await fetchDto(
    '/members',
    jsonRequest('POST', {
      workspace_id,
      display_name: '박민수',
      discord_user_id: '1124',
    }),
  )
  return workspace_id
}

describe('sessionStorage 영속', () => {
  it('가입 계정·세션·워크스페이스·온보딩·연동·팀원 상태가 새로고침 뒤 복원된다', async () => {
    const workspaceId = await walkThroughOnboarding()
    saveDb(sessionStorage)

    // 새로고침: 모듈 상태가 시작 상태로 돌아간다
    resetDb()
    await fetchDto('/auth/logout', { method: 'POST' })
    expect(restoreDb(sessionStorage)).toBe(true)

    await expect(fetchDto<SessionDto>('/auth/me')).resolves.toMatchObject({
      user: { email: 'new@example.com' },
      workspace_count: 1,
      last_workspace_id: workspaceId,
    })
    const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
    expect(items).toHaveLength(1)
    expect(items[0].onboarding).toMatchObject({ current_step: 'connect_discord' })
    await expect(
      fetchDto<IntegrationsDto>(`/workspaces/${workspaceId}/integrations`),
    ).resolves.toMatchObject({ discord: { status: 'connected' } })
    const members = await fetchDto<ListDto<MemberDto>>(`/members?workspace_id=${workspaceId}`)
    expect(members.items.map(({ display_name }) => display_name)).toEqual(['새 사용자', '박민수'])

    // 가입 계정도 남아 있어 로그아웃 뒤 다시 로그인할 수 있다
    await fetchDto('/auth/logout', { method: 'POST' })
    await expect(
      fetchDto<SessionDto>(
        '/auth/login',
        jsonRequest('POST', { email: 'new@example.com', password: 'pass1234' }),
      ),
    ).resolves.toMatchObject({ workspace_count: 1 })
  })

  it('버전 키가 붙어 저장된다', () => {
    saveDb(sessionStorage)
    const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
      version: number
    }
    expect(stored.version).toBe(MOCK_DB_VERSION)
  })

  it('저장값이 없으면 복원하지 않고 db 를 건드리지 않는다', () => {
    expect(restoreDb(sessionStorage)).toBe(false)
    expect(db).toEqual(initialDb())
  })

  it('버전이 다르면 버리고 시작 상태로 둔다', () => {
    const changed = { ...initialDb(), authenticated: false }
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION + 1, db: changed }),
    )
    expect(restoreDb(sessionStorage)).toBe(false)
    expect(db.authenticated).toBe(true)
    expect(sessionStorage.getItem(MOCK_DB_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['JSON 이 아닌 값', '{broken'],
    ['봉투가 아닌 값', JSON.stringify([1, 2, 3])],
    ['db 가 없는 값', JSON.stringify({ version: MOCK_DB_VERSION })],
    [
      '칸이 빠진 db',
      JSON.stringify({ version: MOCK_DB_VERSION, db: { ...initialDb(), workspaces: undefined } }),
    ],
    [
      '칸 종류가 틀린 db',
      JSON.stringify({ version: MOCK_DB_VERSION, db: { ...initialDb(), accounts: {} } }),
    ],
    [
      '세션 모양이 틀린 db',
      JSON.stringify({ version: MOCK_DB_VERSION, db: { ...initialDb(), session: { user: null } } }),
    ],
    [
      '연동 모양이 틀린 db',
      JSON.stringify({
        version: MOCK_DB_VERSION,
        db: { ...initialDb(), integrations: { ws_01: { discord: null } } },
      }),
    ],
  ])('손상된 저장값(%s)은 지우고 시작 상태로 둔다', (_, raw) => {
    sessionStorage.setItem(MOCK_DB_STORAGE_KEY, raw)
    expect(loadSavedDb(sessionStorage)).toBeNull()
    expect(sessionStorage.getItem(MOCK_DB_STORAGE_KEY)).toBeNull()
    expect(restoreDb(sessionStorage)).toBe(false)
    expect(db).toEqual(initialDb())
  })

  it('저장소가 막혀 있어도 던지지 않는다', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(() => saveDb(blocked)).not.toThrow()
    expect(() => clearSavedDb(blocked)).not.toThrow()
    expect(restoreDb(blocked)).toBe(false)
  })
})
