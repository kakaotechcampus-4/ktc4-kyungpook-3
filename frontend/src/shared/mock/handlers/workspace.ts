import { http } from 'msw'
import { db } from '../db'
import { fail, list, ok } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { requireAuth, requireMember } from '../auth-guard'
const base = '/api/v1/workspaces'
export const workspaceHandlers = [
  http.get(base, () => {
    const denied = requireAuth()
    if (denied) return denied
    return list(
      db.workspaces
        .filter(({ workspace_id }) =>
          db.accounts
            .find(({ session }) => session.user.user_id === db.session.user.user_id)
            ?.workspaceIds.includes(workspace_id),
        )
        // 백엔드는 목록에서도 _build_workspace_response 를 불러 role 과 onboarding 을 넣는다.
        // 여기서 깎으면 워크스페이스 선택 화면이 설정 미완료 상태를 못 받는다 (계약 §2.1, D-070)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    )
  }),
  http.post(base, async ({ request }) => {
    const denied = requireAuth()
    if (denied) return denied
    const body = (await request.json()) as { name?: unknown }
    if (typeof body.name !== 'string' || body.name.trim() === '' || body.name.length > 100)
      return fail('INVALID_REQUEST', '이름이 필요합니다.', 400)
    const name = body.name
    const account = db.accounts.find(
      ({ session }) => session.user.user_id === db.session.user.user_id,
    )
    // D-019 는 대소문자를 구분한다. Alpha 와 alpha 는 서로 다른 워크스페이스다.
    // 정규화는 앞뒤 공백 제거와 연속 공백 축약까지다 (D-016, D-018, 계약 §4.0-②-2).
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')
    // D-016·D-018 은 저장 전에도 정규화하라고 정했다. 비교만 정규화하고 원본을 저장하면
    // "  새   팀  " 이 그대로 남는다
    const normalizedName = normalize(name)
    if (
      db.workspaces.some(
        (workspace) =>
          account?.workspaceIds.includes(workspace.workspace_id) &&
          normalize(workspace.name) === normalizedName,
      )
    )
      return fail('WORKSPACE_NAME_DUPLICATED', '이미 존재하는 이름입니다.', 409)
    const workspace = {
      workspace_id: `ws_${String(db.workspaces.length + 1).padStart(2, '0')}`,
      name: normalizedName,
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
    db.integrations[workspace.workspace_id] = {
      discord: { status: 'not_connected', display_name: null, connected_at: null },
      notion: { status: 'not_connected', display_name: null, connected_at: null },
    }
    if (account) {
      account.workspaceIds.push(workspace.workspace_id)
      account.session.workspace_count = account.workspaceIds.length
      account.session.last_workspace_id = workspace.workspace_id
      db.session = structuredClone(account.session)
    }
    return ok(workspace, { status: 201 })
  }),
  http.get(`${base}/:workspaceId`, ({ params }) => {
    // 실 API 는 로그인만 확인하고 멤버십을 보지 않는다 (계약 §4.0-②-1). 그대로 흉내낸다
    const denied = requireAuth()
    if (denied) return denied
    const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === params.workspaceId)
    return workspace ? ok(workspace) : fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
  }),
  http.patch(`${base}/:workspaceId/onboarding`, async ({ params, request }) => {
    const denied = requireMember(String(params.workspaceId))
    if (denied) return denied
    const workspace = db.workspaces.find(({ workspace_id }) => workspace_id === params.workspaceId)
    if (!workspace) return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    // 백엔드는 PM 만 온보딩을 바꿀 수 있다 (workspaces.py 의 update_onboarding)
    if (workspace.role !== 'pm') return fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403)
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
    // 실 API 는 success({}) 만 준다. 갱신된 워크스페이스를 돌려주지 않는다
    // (workspaces.py 의 update_onboarding). 화면은 PATCH 뒤 상세를 다시 조회해야 한다.
    return ok({})
  }),
]
