import { unwrap } from '@/shared/api/envelope'
import type { Envelope } from '@/shared/types/api/envelope'
import type { ListDto } from '@/shared/types/api/envelope'
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
  expect(
    toWorkspace(unwrap((await created.json()) as Envelope<WorkspaceDto>, created.status)),
  ).toMatchObject({ name: '새 워크스페이스', role: 'pm' })
  const duplicate = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ' 카테캠 3팀 ' }),
  })
  expect(duplicate.status).toBe(409)
  const missing = await fetch('http://localhost:3000/api/v1/workspaces/missing')
  expect(missing.status).toBe(404)
})
