import { http } from 'msw'
import { db } from '../db'
import { ok, fail } from '../envelope'

export const integrationHandlers = [
  http.get('/api/v1/workspaces/:workspaceId/integrations', ({ params }) => {
    const integrations = db.integrations[String(params.workspaceId)]
    return integrations
      ? ok(integrations)
      : fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
  }),
  http.delete('/api/v1/workspaces/:workspaceId/integrations/:provider', ({ params }) => {
    const integrations = db.integrations[String(params.workspaceId)]
    if (!integrations) return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    const provider = params.provider
    if (provider !== 'discord' && provider !== 'notion')
      return fail('INVALID_REQUEST', '지원하지 않는 연동입니다.', 400)
    integrations[provider] = { status: 'not_connected', display_name: null, connected_at: null }
    // 실 API 는 204 무본문이다 (계약 §4.0-②-8). 봉투로 바꿔 달라고 요청해 두었지만
    // MSW 는 요청한 미래 형태가 아니라 현재 동작을 흉내낸다. 그래야 화면이 실 API 에서 안 깨진다.
    return new Response(null, { status: 204 })
  }),
]
