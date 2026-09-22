import { unwrap } from '@/shared/api/envelope'
import type { Envelope } from '@/shared/types/api/envelope'
import type { ListDto } from '@/shared/types/api/envelope'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { toWorkspace } from './model/mapper'

it('lists only user workspaces and changes onboarding state', async () => {
  const listed = await fetch('http://localhost:3000/api/v1/workspaces')
  const summaries = unwrap((await listed.json()) as Envelope<ListDto<WorkspaceDto>>, listed.status)
  expect(summaries.total).toBe(2)
  // 백엔드는 목록에서도 role 과 onboarding 을 넣는다 (계약 §2.1).
  // 목록에 onboarding 이 없으면 선택 화면이 설정 미완료 표시를 못 하고 상세를 다시 부르게 된다 (D-070)
  const listedWs02 = summaries.items.find(({ workspace_id }) => workspace_id === 'ws_02')!
  expect(toWorkspace(listedWs02)).toMatchObject({
    role: 'member',
    onboarding: { completed: false, currentStep: 'connect_notion' },
  })
  // ws_02 에서는 member 라 온보딩을 바꿀 수 없다. 백엔드가 PM 만 허용한다
  const refused = await fetch('http://localhost:3000/api/v1/workspaces/ws_02/onboarding', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'connect_notion', action: 'complete' }),
  })
  expect(refused.status).toBe(403)
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

// D-016·D-018 은 "저장하거나 중복 검사하기 전에" 정규화하라고 정했다.
// 비교에만 쓰고 원본을 저장하면 "  새   팀  " 이 그대로 남는다
it('stores the normalized workspace name, not the raw input', async () => {
  const response = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '  새   팀  ' }),
  })
  expect(response.status).toBe(201)
  const created = unwrap((await response.json()) as Envelope<WorkspaceDto>, response.status)
  expect(created.name).toBe('새 팀')
})

// 온보딩 단계 전이는 PM 인 워크스페이스에서만 확인할 수 있다. 새로 만들면 생성자가 PM 이고
// 네 단계가 모두 pending 이다. PATCH 응답은 빈 객체라 갱신 결과는 상세 재조회로 본다 (계약 §4.2)
it('advances onboarding steps in a workspace the user owns', async () => {
  const created = await fetch('http://localhost:3000/api/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '온보딩 확인' }),
  })
  expect(created.status).toBe(201)
  const { workspace_id } = unwrap((await created.json()) as Envelope<WorkspaceDto>, created.status)

  const update = await fetch(`http://localhost:3000/api/v1/workspaces/${workspace_id}/onboarding`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'create_workspace', action: 'complete' }),
  })
  expect(unwrap((await update.json()) as Envelope<Record<string, never>>, update.status)).toEqual(
    {},
  )

  const detail = await fetch(`http://localhost:3000/api/v1/workspaces/${workspace_id}`)
  const updated = toWorkspace(
    unwrap((await detail.json()) as Envelope<WorkspaceDto>, detail.status),
  )
  expect(updated.onboarding.currentStep).toBe('connect_discord')
  expect(updated.onboarding.steps[0]).toEqual({ step: 'create_workspace', status: 'completed' })

  // 건너뛴 단계는 skipped 로 남고 재개 대상에서 빠진다 (D-012)
  await fetch(`http://localhost:3000/api/v1/workspaces/${workspace_id}/onboarding`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step: 'connect_discord', action: 'skip' }),
  })
  const again = await fetch(`http://localhost:3000/api/v1/workspaces/${workspace_id}`)
  expect(
    toWorkspace(unwrap((await again.json()) as Envelope<WorkspaceDto>, again.status)).onboarding
      .currentStep,
  ).toBe('connect_notion')
})
