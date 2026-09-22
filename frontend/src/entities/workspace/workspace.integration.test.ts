import { unwrap } from '@/shared/api/envelope'
import type { Envelope } from '@/shared/types/api/envelope'
import type { ListDto } from '@/shared/types/api/envelope'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { WorkspaceSummaryDto } from '@/shared/types/api/workspace'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { toWorkspace } from './model/mapper'

it('lists only user workspaces and changes onboarding state', async () => {
  const listed = await fetch('http://localhost:3000/api/v1/workspaces')
  const summaries = unwrap(
    (await listed.json()) as Envelope<ListDto<WorkspaceSummaryDto>>,
    listed.status,
  )
  expect(summaries.total).toBe(2)
  expect(summaries.items.find(({ workspace_id }) => workspace_id === 'ws_01')).toMatchObject({
    role: 'pm',
  })
  const update = await fetch('http://localhost:3000/api/v1/workspaces/ws_02/onboarding', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'connect_notion', action: 'complete' }),
  })
  expect(
    toWorkspace(unwrap((await update.json()) as Envelope<WorkspaceDto>, update.status)),
  ).toMatchObject({ id: 'ws_02', onboarding: { currentStep: 'connect_members' } })
  const detail = await fetch('http://localhost:3000/api/v1/workspaces/ws_02')
  expect(
    toWorkspace(unwrap((await detail.json()) as Envelope<WorkspaceDto>, detail.status)).onboarding
      .steps[2],
  ).toEqual({ step: 'connect_notion', status: 'completed' })
})

it('collapses internal whitespace when detecting duplicate workspace names', async () => {
  const response = await fetch(`${location.origin}/api/v1/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  카테캠   3팀  ' }),
  })
  expect(response.status).toBe(409)
})

it('creates a workspace and rejects duplicate names or unknown workspace requests', async () => {
  const created = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '새 워크스페이스' }),
  })
  const workspace = toWorkspace(
    unwrap((await created.json()) as Envelope<WorkspaceDto>, created.status),
  )
  expect(workspace).toMatchObject({ name: '새 워크스페이스', role: 'pm' })
  const integrations = await fetch(
    `http://localhost:3000/api/v1/workspaces/${workspace.id}/integrations`,
  )
  expect(
    unwrap((await integrations.json()) as Envelope<IntegrationsDto>, integrations.status),
  ).toMatchObject({
    discord: { status: 'not_connected' },
    notion: { status: 'not_connected' },
  })
  const duplicate = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ' 카테캠 3팀 ' }),
  })
  expect(duplicate.status).toBe(409)
  const missing = await fetch('http://localhost:3000/api/v1/workspaces/missing')
  expect(missing.status).toBe(404)
})

it('allows different accounts to use the same workspace name', async () => {
  const signup = await fetch('http://localhost:3000/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', password: 'secret', name: '새 사용자' }),
  })
  expect(signup.status).toBe(201)

  const created = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '카테캠 3팀' }),
  })
  expect(created.status).toBe(201)
})

// D-019 — 영문 대소문자를 구분해 서로 다른 이름으로 본다. Alpha 와 alpha 를 각각 만들 수 있다.
// 계약이 초안부터 "대소문자 무시" 를 요청해 온 것은 D-019 와 어긋난 오류였다 (계약 §4.0-②-2)
it('treats names that differ only by letter case as different workspaces', async () => {
  const create = (name: string) =>
    fetch('http://localhost:3000/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  expect((await create('Alpha')).status).toBe(201)
  expect((await create('alpha')).status).toBe(201)
  // 공백 정규화는 그대로 적용된다 — 앞뒤 공백과 연속 공백만 다르면 중복이다 (D-016, D-018)
  expect((await create('  Alpha  ')).status).toBe(409)
  expect((await create('Al  pha')).status).toBe(201)
})
