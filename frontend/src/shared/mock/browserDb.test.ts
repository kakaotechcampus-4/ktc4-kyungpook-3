import { fetchDto, fetchSessionDto, jsonRequest } from '@/shared/test/api'
import { db, initialDb } from './db'
import { MOCK_SCENARIO_PARAM, prepareBrowserDb } from './browserDb'
import { MOCK_DB_STORAGE_KEY, MOCK_DB_VERSION, saveDb } from './persistence'
import { createScenarioDb } from './scenarios'

const at = (path: string) => new URL(path, location.origin)

afterEach(() => {
  sessionStorage.clear()
})

describe('브라우저 MSW 시작 상태', () => {
  it('Vitest 는 로그인된 픽스처 상태로 시작한다 — 브라우저 시작 규칙을 타지 않는다', async () => {
    expect(db).toEqual(initialDb())
    await expect(fetchSessionDto()).resolves.toMatchObject({ user: { user_id: 'us_01' } })
  })

  it('저장값이 없으면 비로그인으로 시작한다', async () => {
    expect(prepareBrowserDb(at('/'), sessionStorage)).toEqual({
      scenario: 'signed-out',
      cleanPath: null,
    })
    await expect(fetchSessionDto()).resolves.toBeNull()
  })

  it('저장값이 있으면 복원한다 — 새로고침과 OAuth 왕복', async () => {
    prepareBrowserDb(at('/'), sessionStorage)
    await fetchDto(
      '/auth/signup',
      jsonRequest('POST', { email: 'new@example.com', password: 'pass1234', name: '새 사용자' }),
    )
    saveDb(sessionStorage)

    expect(prepareBrowserDb(at('/onboarding/create_workspace'), sessionStorage)).toEqual({
      scenario: null,
      cleanPath: null,
    })
    await expect(fetchSessionDto()).resolves.toMatchObject({ user: { email: 'new@example.com' } })
  })

  it('버전이 다른 저장값은 버리고 비로그인으로 시작한다', async () => {
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION - 1, db: initialDb() }),
    )
    expect(prepareBrowserDb(at('/'), sessionStorage).scenario).toBe('signed-out')
    await expect(fetchSessionDto()).resolves.toBeNull()
  })

  it('손상된 저장값은 버리고 비로그인으로 시작한다', async () => {
    sessionStorage.setItem(MOCK_DB_STORAGE_KEY, 'not json')
    expect(prepareBrowserDb(at('/'), sessionStorage).scenario).toBe('signed-out')
    await expect(fetchSessionDto()).resolves.toBeNull()
  })

  it('시나리오 파라미터는 저장값보다 앞서고, 적용한 상태를 저장하고, 주소에서 떼어 낸다', () => {
    saveDb(sessionStorage)
    const prepared = prepareBrowserDb(
      at(`/login?${MOCK_SCENARIO_PARAM}=no-workspace&next=1#top`),
      sessionStorage,
    )
    expect(prepared).toEqual({ scenario: 'no-workspace', cleanPath: '/login?next=1#top' })
    expect(db).toEqual(createScenarioDb('no-workspace'))
    const stored = JSON.parse(sessionStorage.getItem(MOCK_DB_STORAGE_KEY) ?? 'null') as {
      db: unknown
    }
    expect(stored.db).toEqual(createScenarioDb('no-workspace'))
  })

  it('모르는 시나리오는 경고하고 저장값 규칙대로 시작한다', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(prepareBrowserDb(at(`/?${MOCK_SCENARIO_PARAM}=nope`), sessionStorage)).toEqual({
        scenario: 'signed-out',
        cleanPath: '/',
      })
      expect(warning).toHaveBeenCalled()
      await expect(fetchSessionDto()).resolves.toBeNull()
    } finally {
      warning.mockRestore()
    }
  })
})
