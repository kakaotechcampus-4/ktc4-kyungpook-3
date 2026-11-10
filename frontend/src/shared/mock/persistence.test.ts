import { fetchDto, jsonRequest, signUpVerified } from '@/shared/test/api'
import type { SessionDto, SignupCodeConfirmedDto } from '@/shared/types/api/auth'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ListDto } from '@/shared/types/api/envelope'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { MemberAliasDto, MemberDto } from '@/shared/types/api/member'
import type { TaskDto } from '@/shared/types/api/task'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb, resetDb } from './db'
import { settleMockOAuth } from './oauth/mockOAuth'
import { applyScenario } from './scenarios'
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
  await signUpVerified({ email: 'new@example.com', password: 'pass1234', name: '새 사용자' })
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

  it('이메일·비밀번호 없는 카카오 계정으로 로그인한 상태도 새로고침 뒤 복원된다 (#627)', () => {
    applyScenario('kakao-account')
    const saved = structuredClone(db)
    saveDb(sessionStorage)
    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db.authenticated).toBe(true)
    expect(db.session.user).toEqual(saved.session.user)
    expect(db.accounts[0]).toMatchObject({ password: null, session: { user: { email: null } } })
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
    { name: '가입 인증만 있는 17', omitted: ['alias_candidate', 'alias_text'] },
    { name: '별칭 관리만 있는 17', omitted: ['signupVerification', 'kakao'] },
  ])('서로 다른 스키마가 같은 버전을 쓴 저장본은 복원하지 않는다: $name', ({ omitted }) => {
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: 17, db: initialDb() }, (key, value: unknown) =>
        omitted.includes(key) ? undefined : value,
      ),
    )

    expect(restoreDb(sessionStorage)).toBe(false)
    expect(sessionStorage.getItem(MOCK_DB_STORAGE_KEY)).toBeNull()
    expect(db).toEqual(initialDb())
  })

  it('가입 증명·카카오 신원과 별칭·별칭 후보를 함께 저장하고 복원한다', async () => {
    await fetchDto('/members/mb_02/aliases', jsonRequest('POST', { alias_text: '복원 별칭' }))
    const email = 'pending-restore@example.com'
    await fetchDto('/auth/signup/code', jsonRequest('POST', { email }))
    const mail = db.signupVerification.outbox.at(-1)
    if (mail === undefined) throw new Error('가입 코드 메일이 없다')
    const { verification_token } = await fetchDto<SignupCodeConfirmedDto>(
      '/auth/signup/code/confirm',
      jsonRequest('POST', { email, code: mail.code }),
    )
    db.accounts[0].kakaoId = 'linked-kakao'
    db.kakao.pending = { kakaoId: 'pending-kakao', nickname: '가입 대기' }
    saveDb(sessionStorage)

    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)

    expect(db.signupVerification.proofs[verification_token]).toMatchObject({ email })
    expect(db.signupVerification.outbox).toContainEqual(mail)
    expect(db.accounts[0].kakaoId).toBe('linked-kakao')
    await expect(fetchDto('/auth/kakao/pending')).resolves.toEqual({ nickname: '가입 대기' })
    const aliases = await fetchDto<ListDto<MemberAliasDto>>('/members/aliases?workspace_id=ws_01')
    expect(aliases.items).toContainEqual(
      expect.objectContaining({ member_id: 'mb_02', alias_text: '복원 별칭', verified: true }),
    )
    await expect(fetchDto<ApprovalDto>('/approvals/ap_03')).resolves.toMatchObject({
      alias_candidate: true,
      alias_text: '지훈',
    })
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

  // M6 S1: Task 에 version·notion_sync_status 가 생겼지만 저장 버전은 그대로다. 그 전에 저장된 데모 상태가
  // 버려지거나, 버전 없는 태스크가 매핑 실패로 화면을 깨뜨리지 않아야 한다
  it('version·notion_sync_status 가 없는 예전 태스크 저장본을 version 1, null 로 복원한다', async () => {
    const legacy = initialDb()
    for (const task of legacy.tasks as Partial<TaskDto>[]) {
      delete task.version
      delete task.notion_sync_status
    }
    legacy.tasks[1].title = '저장된 제목'
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION, db: legacy }),
    )

    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db.tasks).toHaveLength(legacy.tasks.length)
    for (const task of db.tasks) {
      expect(task.version).toBe(1)
      expect(task.notion_sync_status).toBeNull()
    }
    const restored = await fetchDto<TaskDto>(`/tasks/${legacy.tasks[1].task_id}`)
    expect(restored).toMatchObject({ title: '저장된 제목', version: 1, notion_sync_status: null })
  })

  it('고친 제목·발화 칸이 없는 예전 회의록 저장본은 고친 적 없고 줄 번호가 순서인 회의록으로 복원한다 (#551)', () => {
    const legacy = JSON.parse(JSON.stringify(initialDb())) as {
      minutes: Record<string, unknown>[]
    }
    for (const minutes of legacy.minutes) {
      delete minutes.title_edited
      delete minutes.title_original
      for (const line of minutes.transcript as Record<string, unknown>[])
        for (const key of ['seq', 'edited', 'original_text']) delete line[key]
    }
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION, db: legacy }),
    )

    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db.minutes).toEqual(initialDb().minutes)
  })

  it('이미 있는 version·notion_sync_status 는 복원할 때 바꾸지 않는다', () => {
    const saved = initialDb()
    saved.tasks[0].version = 4
    saved.tasks[0].notion_sync_status = 'failed'
    sessionStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({ version: MOCK_DB_VERSION, db: saved }),
    )

    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db.tasks[0]).toMatchObject({ version: 4, notion_sync_status: 'failed' })
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
