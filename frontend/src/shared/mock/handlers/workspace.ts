import { http } from 'msw'
import { db } from '../db'
import { fail, list, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
const base = '/api/v1/workspaces'
export const workspaceHandlers = [
  http.get(base, () =>
    list(
      db.workspaces
        .filter(({ workspace_id }) =>
          db.accounts
            .find(({ session }) => session.user.user_id === db.session.user.user_id)
            ?.workspaceIds.includes(workspace_id),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(({ workspace_id, name, role, created_at }) => ({
          workspace_id,
          name,
          role,
          created_at,
        })),
    ),
  ),
  http.post(base, async ({ request }) => {
    const body = (await request.json()) as { name?: unknown }
    if (typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 100)
      return fail('INVALID_REQUEST', '이름이 필요합니다.', 400)
    const name = body.name
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    if (db.workspaces.some((workspace) => normalize(workspace.name) === normalize(name)))
      return fail('WORKSPACE_NAME_DUPLICATED', '이미 존재하는 이름입니다.', 409)
    const workspace = {
      workspace_id: `ws_${String(db.workspaces.length + 1).padStart(2, '0')}`,
      name,
      role: 'pm',
      created_at: MOCK_NOW,
      onboarding: {
        completed: false,
        current_step: 'create_workspace',
        steps: [
          { step: 'create_workspace', status: 'pending' },
          { step: 'connect_discord', status: 'pending' },
          { step: 'connect_notion', status: 'pending' },
          { step: 'connect_members', status: 'pending' },
        ],
      },
    }
    db.workspaces.push(workspace)
    const account = db.accounts.find(
      ({ session }) => session.user.user_id === db.session.user.user_id,
    )
    if (account) {
      account.workspaceIds.push(workspace.workspace_id)
      account.session.workspace_count = account.workspaceIds.length
      account.session.last_workspace_id = workspace.workspace_id
      db.session = structuredClone(account.session)
    }
    return ok(workspace, { status: 201 })
  }),
  http.get(`${base}/:workspaceId`, ({ params }) => {
    const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === params.workspaceId)
    return workspace ? ok(workspace) : fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
  }),
  http.patch(`${base}/:workspaceId/onboarding`, async ({ params, request }) => {
    const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === params.workspaceId)
    if (!workspace) return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    const body = (await request.json()) as { step?: unknown; action?: unknown }
    const item = workspace.onboarding.steps.find(({ step }) => step === body.step)
    if (!item || (body.action !== 'skip' && body.action !== 'complete'))
      return fail('INVALID_REQUEST', '온보딩 요청이 올바르지 않습니다.', 400)
    item.status = body.action === 'skip' ? 'skipped' : 'completed'
    workspace.onboarding.completed = workspace.onboarding.steps.every(
      ({ status }) => status !== 'pending',
    )
    workspace.onboarding.current_step =
      workspace.onboarding.steps.find(({ status }) => status === 'pending')?.step ?? null
    return ok(workspace)
  }),
]
