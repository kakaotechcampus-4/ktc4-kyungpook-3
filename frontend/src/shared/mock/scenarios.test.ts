import { fetchDto, fetchSessionDto, jsonRequest } from '@/shared/test/api'
import type { SessionDto } from '@/shared/types/api/auth'
import type { ListDto } from '@/shared/types/api/envelope'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb } from './db'
import { MOCK_SCENARIOS, applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'

async function listedWorkspaces() {
  const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
  return items.map(({ workspace_id, role, onboarding }) => ({
    id: workspace_id,
    role,
    completed: onboarding.completed,
  }))
}

describe('E2E 시나리오', () => {
  it('비로그인: 세션이 없고, 픽스처 계정으로 로그인하면 공간 2개다', async () => {
    applyScenario('signed-out')
    await expect(fetchSessionDto()).resolves.toBeNull()
    await expect(
      fetchDto<SessionDto>(
        '/auth/login',
        jsonRequest('POST', { email: 'pm@example.com', password: 'mock-password' }),
      ),
    ).resolves.toMatchObject({ workspace_count: 2 })
  })

  it('공간 0개: 로그인돼 있고 목록이 비었다', async () => {
    applyScenario('no-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 0,
      last_workspace_id: null,
    })
    await expect(listedWorkspaces()).resolves.toEqual([])
  })

  it('공간 1개: 완료된 ws_01 하나다', async () => {
    applyScenario('single-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 1,
      last_workspace_id: 'ws_01',
    })
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_01', role: 'pm', completed: true },
    ])
  })

  it('공간 여러 개: Vitest 기본 상태와 같다', async () => {
    applyScenario('multiple-workspaces')
    expect(db).toEqual(initialDb())
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_02', role: 'member', completed: false },
      { id: 'ws_01', role: 'pm', completed: true },
    ])
  })

  it('미완료 공간: PM 인 공간 하나가 Discord 연결 단계에 멈춰 있다', async () => {
    applyScenario('incomplete-workspace')
    await expect(fetchSessionDto()).resolves.toMatchObject({
      workspace_count: 1,
      last_workspace_id: 'ws_03',
    })
    await expect(listedWorkspaces()).resolves.toEqual([
      { id: 'ws_03', role: 'pm', completed: false },
    ])
    await expect(fetchDto<WorkspaceDto>('/workspaces/ws_03')).resolves.toMatchObject({
      onboarding: { current_step: 'connect_discord' },
    })
    await expect(fetchDto('/workspaces/ws_03/integrations')).resolves.toMatchObject({
      discord: { status: 'not_connected' },
    })
    // 생성자가 PM 팀원으로 있다 — 팀원 연결 단계가 기존 PM 을 재사용한다
    await expect(fetchDto('/members?workspace_id=ws_03')).resolves.toMatchObject({
      items: [{ role: 'pm', display_name: '최진호' }],
    })
    // PM 이라 온보딩을 이어 갈 수 있다
    await expect(
      fetchDto(
        '/workspaces/ws_03/onboarding',
        jsonRequest('PATCH', { step: 'connect_discord', action: 'skip' }),
      ),
    ).resolves.toEqual({})
  })

  it('시나리오끼리 독립적이다 — 앞 시나리오의 변경이 다음 적용에 남지 않는다', async () => {
    for (const first of MOCK_SCENARIOS) {
      applyScenario(first)
      // 앞 시나리오에서 상태를 바꾼다
      await fetchDto(
        '/auth/signup',
        jsonRequest('POST', { email: `${first}@example.com`, password: 'pass1234', name: first }),
      )
      await fetchDto('/workspaces', jsonRequest('POST', { name: `${first} 팀` }))
      for (const next of MOCK_SCENARIOS) {
        applyScenario(next)
        expect({ first, next, db: structuredClone(db) }).toEqual({
          first,
          next,
          db: createScenarioDb(next),
        })
      }
    }
  })

  it('만들 때마다 새 객체다 — 한 시나리오 값을 고쳐도 다른 값에 번지지 않는다', () => {
    const scenarios = MOCK_SCENARIOS.map((name: MockScenario) => createScenarioDb(name))
    scenarios[0].accounts[0].workspaceIds.push('ws_99')
    scenarios[0].workspaces[0].name = '바뀜'
    expect(createScenarioDb('signed-out')).toEqual(createScenarioDb('signed-out'))
    expect(createScenarioDb('signed-out').accounts[0].workspaceIds).not.toContain('ws_99')
    expect(initialDb().workspaces[0].name).not.toBe('바뀜')
  })
})
