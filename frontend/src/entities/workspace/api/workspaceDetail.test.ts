import { createQueryClient } from '@/shared/api/queryClient'
import { recordRequestBodies } from '@/shared/test/requests'
import type { Workspace } from '../model/types'
import {
  createWorkspace,
  fetchWorkspace,
  upsertWorkspaceInList,
  workspaceDetailQueryOptions,
} from './workspaceDetail'
import { WORKSPACE_LIST_QUERY_KEY, workspaceListQueryOptions } from './workspaceList'

describe('createWorkspace', () => {
  it('생성자가 PM 이고 네 단계가 pending 인 Workspace 를 돌려준다', async () => {
    const workspace = await createWorkspace({ name: '새 팀' })
    expect(workspace).toMatchObject({
      name: '새 팀',
      role: 'pm',
      onboarding: { completed: false, currentStep: 'create_workspace' },
    })
    expect(workspace.onboarding.steps.every(({ status }) => status === 'pending')).toBe(true)
  })

  it('WorkspaceCreateRequest 모양 { name } 으로 보낸다', async () => {
    const bodies = recordRequestBodies('POST', '/workspaces')
    await createWorkspace({ name: '새 팀' })
    await vi.waitFor(() => expect(bodies).toEqual([{ name: '새 팀' }]))
  })

  it('계정 안의 같은 이름은 409 WORKSPACE_NAME_DUPLICATED 로 던진다', async () => {
    await expect(createWorkspace({ name: '카테캠 3팀' })).rejects.toMatchObject({
      status: 409,
      code: 'WORKSPACE_NAME_DUPLICATED',
    })
  })
})

describe('워크스페이스 상세', () => {
  it('Workspace 로 돌려준다', async () => {
    await expect(fetchWorkspace('ws_02')).resolves.toMatchObject({
      id: 'ws_02',
      role: 'member',
      onboarding: { currentStep: 'connect_notion' },
    })
  })

  it('key 에 workspaceId 가 있다 — 공간마다 캐시가 나뉜다', () => {
    expect(workspaceDetailQueryOptions('ws_01').queryKey).toEqual(['workspace', 'ws_01', 'detail'])
    expect(workspaceDetailQueryOptions('ws_02').queryKey).not.toEqual(
      workspaceDetailQueryOptions('ws_01').queryKey,
    )
  })
})

describe('upsertWorkspaceInList', () => {
  const created = (): Promise<Workspace> => createWorkspace({ name: '목록 확인' })

  it('목록에 없는 공간은 맨 앞에 넣는다 — 목록은 생성일 내림차순이다', async () => {
    const client = createQueryClient()
    await client.fetchQuery(workspaceListQueryOptions())
    const workspace = await created()
    upsertWorkspaceInList(client, workspace)
    expect(client.getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY)?.map(({ id }) => id)).toEqual(
      [workspace.id, 'ws_02', 'ws_01'],
    )
  })

  it('목록에 있는 공간은 그 자리에서 바꾼다', async () => {
    const client = createQueryClient()
    const [first, second] = await client.fetchQuery(workspaceListQueryOptions())
    upsertWorkspaceInList(client, { ...second, name: '바뀐 이름' })
    expect(client.getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY)).toEqual([
      first,
      { ...second, name: '바뀐 이름' },
    ])
  })

  it('목록을 아직 받지 않았으면 만들지 않는다 — 가드가 새로 받는다', async () => {
    const client = createQueryClient()
    upsertWorkspaceInList(client, await created())
    expect(client.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toBeUndefined()
  })
})
