import { http } from 'msw'
import type { QueryClient } from '@tanstack/react-query'
import { createQueryClient } from '@/shared/api/queryClient'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { Workspace } from '../model/types'
import { saveOnboardingStep, updateOnboarding } from './onboarding'
import { createWorkspace, workspaceDetailQueryOptions } from './workspaceDetail'
import { WORKSPACE_LIST_QUERY_KEY, workspaceListQueryOptions } from './workspaceList'

/** 목록 캐시에 든 그 공간의 현재 단계 */
function listedStep(client: QueryClient, workspaceId: string) {
  return client
    .getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY)
    ?.find(({ id }) => id === workspaceId)?.onboarding.currentStep
}

/** 새 PM 공간을 만들고 목록 캐시를 채운다. 목록 캐시의 그 공간은 생성 단계다 */
async function preparedWorkspace() {
  const client = createQueryClient()
  const { id } = await createWorkspace({ name: '온보딩 팀' })
  await client.fetchQuery(workspaceListQueryOptions())
  return { client, id }
}

describe('updateOnboarding', () => {
  it('WorkspaceOnboardingUpdateRequest 모양 { step, action } 으로 보낸다', async () => {
    const { id } = await createWorkspace({ name: '온보딩 팀' })
    const bodies = recordRequestBodies('PATCH', `/workspaces/${id}/onboarding`)
    await expect(
      updateOnboarding(id, { step: 'connect_discord', action: 'skip' }),
    ).resolves.toBeUndefined()
    await vi.waitFor(() => expect(bodies).toEqual([{ step: 'connect_discord', action: 'skip' }]))
  })

  it('일반 팀원은 403 으로 던진다', async () => {
    await expect(
      updateOnboarding('ws_02', { step: 'connect_notion', action: 'complete' }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
})

describe('saveOnboardingStep', () => {
  it('갱신 성공 → 상세 재조회 → 목록 캐시 반영 순서다', async () => {
    const { client, id } = await preparedWorkspace()
    // 상세 응답을 쥐고 있는 동안 목록 캐시가 먼저 바뀌지 않는지 본다. 반환값이 없으면 원래 handler 로 넘어간다
    const detail = deferred()
    server.use(
      http.get('/api/v1/workspaces/:workspaceId', async () => {
        await detail.promise
      }),
    )
    const log = recordRequests()

    const saving = saveOnboardingStep(client, id, { step: 'create_workspace', action: 'complete' })
    await vi.waitFor(() => expect(log.timeline).toContain(`start GET /workspaces/${id}`))

    expect(log.timeline).toEqual([
      `start PATCH /workspaces/${id}/onboarding`,
      `answer PATCH /workspaces/${id}/onboarding`,
      `start GET /workspaces/${id}`,
    ])
    expect(listedStep(client, id)).toBe('create_workspace')

    detail.resolve()
    const saved = await saving
    expect(saved.onboarding).toMatchObject({ currentStep: 'connect_discord' })
    expect(listedStep(client, id)).toBe('connect_discord')
    expect(client.getQueryData(workspaceDetailQueryOptions(id).queryKey)).toEqual(saved)
    expect(log.timeline.at(-1)).toBe(`answer GET /workspaces/${id}`)
  })

  it('상세 캐시가 최신이어도 PATCH 뒤에는 다시 받는다', async () => {
    const { client, id } = await preparedWorkspace()
    await client.fetchQuery(workspaceDetailQueryOptions(id))
    const log = recordRequests()
    await saveOnboardingStep(client, id, { step: 'create_workspace', action: 'complete' })
    expect(log.started.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `PATCH /workspaces/${id}/onboarding`,
      `GET /workspaces/${id}`,
    ])
  })

  it('PATCH 전에 시작한 상세 요청이 진행 중이어도 PATCH 뒤의 값을 반영한다', async () => {
    const { client, id } = await preparedWorkspace()
    // 화면이 구독한 상세 요청이 PATCH 직전에 떠나 PATCH 뒤에 답한다
    const early = deferred()
    server.use(
      http.get(
        '/api/v1/workspaces/:workspaceId',
        async () => {
          await early.promise
        },
        { once: true },
      ),
    )
    const log = recordRequests()
    const observed = client.fetchQuery(workspaceDetailQueryOptions(id)).then(
      () => 'finished',
      () => 'cancelled',
    )
    await vi.waitFor(() => expect(log.started).toHaveLength(1))

    const saving = saveOnboardingStep(client, id, { step: 'create_workspace', action: 'complete' })
    const saved = await saving
    early.resolve()

    expect(saved.onboarding.currentStep).toBe('connect_discord')
    expect(listedStep(client, id)).toBe('connect_discord')
    await expect(observed).resolves.toBe('cancelled')
    // 앞선 상세 요청에 합쳐지지 않고 PATCH 뒤에 새 상세 요청이 나갔다
    expect(log.started.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /workspaces/${id}`,
      `PATCH /workspaces/${id}/onboarding`,
      `GET /workspaces/${id}`,
    ])
  })

  it('갱신이 실패하면 상세를 부르지 않고 목록 캐시도 그대로다', async () => {
    const { client, id } = await preparedWorkspace()
    server.use(
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    const log = recordRequests()
    await expect(
      saveOnboardingStep(client, id, { step: 'create_workspace', action: 'complete' }),
    ).rejects.toMatchObject({ status: 500 })
    expect(log.started.map(({ method }) => method)).toEqual(['PATCH'])
    expect(listedStep(client, id)).toBe('create_workspace')
  })

  it('상세 재조회가 실패하면 던지고 목록 캐시를 추측으로 고치지 않는다', async () => {
    const { client, id } = await preparedWorkspace()
    server.use(
      http.get('/api/v1/workspaces/:workspaceId', () => fail('INTERNAL_ERROR', 'boom', 500)),
    )
    await expect(
      saveOnboardingStep(client, id, { step: 'create_workspace', action: 'complete' }),
    ).rejects.toMatchObject({ status: 500 })
    expect(listedStep(client, id)).toBe('create_workspace')
  })

  it('마지막 단계까지 저장하면 목록 캐시의 공간이 완료로 바뀐다', async () => {
    const { client, id } = await preparedWorkspace()
    for (const step of ['create_workspace', 'connect_discord', 'connect_notion'] as const)
      await saveOnboardingStep(client, id, { step, action: 'complete' })
    const done = await saveOnboardingStep(client, id, { step: 'connect_members', action: 'skip' })
    expect(done.onboarding).toMatchObject({ completed: true, currentStep: null })
    expect(
      client.getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY)?.find((item) => item.id === id)
        ?.onboarding.completed,
    ).toBe(true)
  })
})
